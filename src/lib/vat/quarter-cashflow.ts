import { classifyUnmatchedBankLine } from "@/lib/vat/classify-bank";
import { groupUnmatchedBank, type BankBucket } from "@/lib/vat/build-filing-context";
import { getReviewData } from "@/lib/supabase/queries";
import { createSupabaseAdmin } from "@/lib/supabase/server";

export type QuarterCashflow = {
  ok: boolean;
  message: string;
  filingLabel: string;
  periodRange: string;
  bankLineCount: number;
  einnahmenEur: number;
  ausgabenEur: number;
  internalTransfersEur: number;
  netCashflowEur: number;
  unmatchedIncomeEur: number;
  unmatchedExpenseEur: number;
  byBucket: BankBucket[];
  topIncoming: Array<{ label: string; totalEur: number; count: number }>;
  topOutgoing: Array<{ label: string; totalEur: number; count: number }>;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

type BankLine = {
  amount: number;
  description: string | null;
  counterparty: string | null;
  reconciliation_status: string | null;
  treatment_case: string | null;
};

function lineLabel(line: BankLine): string {
  return (line.counterparty ?? line.description ?? "Unknown").slice(0, 48);
}

function aggregateByLabel(
  lines: BankLine[],
  direction: "in" | "out",
): Array<{ label: string; totalEur: number; count: number }> {
  const map = new Map<string, { totalEur: number; count: number }>();
  for (const line of lines) {
    const amt = line.amount;
    if (direction === "in" && amt <= 0) continue;
    if (direction === "out" && amt >= 0) continue;
    const label = lineLabel(line);
    const entry = map.get(label) ?? { totalEur: 0, count: 0 };
    entry.totalEur += Math.abs(amt);
    entry.count += 1;
    map.set(label, entry);
  }
  return [...map.entries()]
    .map(([label, data]) => ({ label, totalEur: round2(data.totalEur), count: data.count }))
    .sort((a, b) => b.totalEur - a.totalEur)
    .slice(0, 8);
}

export async function getQuarterCashflow(filingPeriodId: string): Promise<QuarterCashflow> {
  const review = await getReviewData(filingPeriodId);
  if (!review) {
    return {
      ok: false,
      message: "Filing not found.",
      filingLabel: "",
      periodRange: "",
      bankLineCount: 0,
      einnahmenEur: 0,
      ausgabenEur: 0,
      internalTransfersEur: 0,
      netCashflowEur: 0,
      unmatchedIncomeEur: 0,
      unmatchedExpenseEur: 0,
      byBucket: [],
      topIncoming: [],
      topOutgoing: [],
    };
  }

  const supabase = createSupabaseAdmin();
  const { data: session } = await supabase
    .from("upload_sessions")
    .select("id")
    .eq("filing_period_id", filingPeriodId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!session) {
    return {
      ok: false,
      message: "No upload session.",
      filingLabel: review.filingLabel,
      periodRange: review.periodRange,
      bankLineCount: 0,
      einnahmenEur: 0,
      ausgabenEur: 0,
      internalTransfersEur: 0,
      netCashflowEur: 0,
      unmatchedIncomeEur: 0,
      unmatchedExpenseEur: 0,
      byBucket: groupUnmatchedBank(review),
      topIncoming: [],
      topOutgoing: [],
    };
  }

  const { data: bankRows } = await supabase
    .from("bank_transactions")
    .select("amount, description, counterparty, reconciliation_status, treatment_case")
    .eq("session_id", session.id);

  const lines: BankLine[] = (bankRows ?? []).map((row) => ({
    amount: Number(row.amount),
    description: row.description,
    counterparty: row.counterparty,
    reconciliation_status: row.reconciliation_status,
    treatment_case: row.treatment_case,
  }));

  let einnahmen = 0;
  let ausgaben = 0;
  let internal = 0;
  let unmatchedIncome = 0;
  let unmatchedExpense = 0;

  const incoming: BankLine[] = [];
  const outgoing: BankLine[] = [];

  for (const line of lines) {
    const c = classifyUnmatchedBankLine(line.description, line.counterparty, line.amount);
    const isInternal =
      line.treatment_case === "internal_transfer" ||
      c.vatCase === "internal_transfer" ||
      c.action === "ignore";

    if (isInternal) {
      internal += Math.abs(line.amount);
      continue;
    }

    if (line.amount > 0) {
      einnahmen += line.amount;
      incoming.push(line);
      if (line.reconciliation_status !== "matched") unmatchedIncome += line.amount;
    } else if (line.amount < 0) {
      ausgaben += Math.abs(line.amount);
      outgoing.push(line);
      if (line.reconciliation_status !== "matched") unmatchedExpense += Math.abs(line.amount);
    }
  }

  const byBucket = groupUnmatchedBank(review);

  return {
    ok: true,
    message: `${review.filingLabel}: Einnahmen €${round2(einnahmen).toFixed(2)}, Ausgaben €${round2(ausgaben).toFixed(2)} (excl. internal transfers €${round2(internal).toFixed(2)}).`,
    filingLabel: review.filingLabel,
    periodRange: review.periodRange,
    bankLineCount: lines.length,
    einnahmenEur: round2(einnahmen),
    ausgabenEur: round2(ausgaben),
    internalTransfersEur: round2(internal),
    netCashflowEur: round2(einnahmen - ausgaben),
    unmatchedIncomeEur: round2(unmatchedIncome),
    unmatchedExpenseEur: round2(unmatchedExpense),
    byBucket,
    topIncoming: aggregateByLabel(incoming, "in"),
    topOutgoing: aggregateByLabel(outgoing, "out"),
  };
}

export function formatCashflowForContext(cashflow: QuarterCashflow): string {
  if (!cashflow.ok) return "";
  return [
    `QUARTER CASHFLOW (${cashflow.periodRange}): Einnahmen €${cashflow.einnahmenEur.toFixed(2)} | Ausgaben €${cashflow.ausgabenEur.toFixed(2)} | Net €${cashflow.netCashflowEur.toFixed(2)} | Internal excluded €${cashflow.internalTransfersEur.toFixed(2)}`,
    `UNMATCHED: income €${cashflow.unmatchedIncomeEur.toFixed(2)} | expenses €${cashflow.unmatchedExpenseEur.toFixed(2)}`,
    `TOP INCOMING: ${JSON.stringify(cashflow.topIncoming.slice(0, 5))}`,
    `TOP OUTGOING: ${JSON.stringify(cashflow.topOutgoing.slice(0, 5))}`,
  ].join("\n");
}

export function cashflowToToolResult(cashflow: QuarterCashflow): Record<string, unknown> {
  return {
    ok: cashflow.ok,
    message: cashflow.message,
    filingLabel: cashflow.filingLabel,
    periodRange: cashflow.periodRange,
    einnahmenEur: cashflow.einnahmenEur,
    ausgabenEur: cashflow.ausgabenEur,
    internalTransfersEur: cashflow.internalTransfersEur,
    netCashflowEur: cashflow.netCashflowEur,
    unmatchedIncomeEur: cashflow.unmatchedIncomeEur,
    unmatchedExpenseEur: cashflow.unmatchedExpenseEur,
    byBucket: cashflow.byBucket,
    topIncoming: cashflow.topIncoming,
    topOutgoing: cashflow.topOutgoing,
  };
}
