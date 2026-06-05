import { classifyUnmatchedBankLine } from "@/lib/vat/classify-bank";
import { formatTriageForPrompt } from "@/lib/vat/bank-triage";
import type { ReviewData } from "@/lib/supabase/queries";
import { getReviewData } from "@/lib/supabase/queries";

export type BankBucket = {
  label: string;
  count: number;
  totalAbs: number;
  filingAction: string;
  examples: string[];
};

export function groupUnmatchedBank(review: ReviewData): BankBucket[] {
  const buckets = new Map<string, BankBucket>();

  for (const line of review.unmatchedBank) {
    const c = classifyUnmatchedBankLine(line.description, line.counterparty, line.amount);
    const key = `${c.action}:${c.vatCase}`;

    const label =
      c.action === "ignore"
        ? "Internal / ignore"
        : c.vatCase === "non_eu_service_rc"
          ? "US/EU SaaS (reverse charge)"
          : c.vatCase === "private_mixed"
            ? "Likely private / no DE VAT"
            : c.action === "need_invoice"
              ? "Missing Beleg — fix or exclude"
              : "Review manually";

    const existing = buckets.get(key);
    const desc = (line.description ?? line.counterparty ?? "—").slice(0, 40);

    if (existing) {
      existing.count += 1;
      existing.totalAbs += Math.abs(line.amount);
      if (existing.examples.length < 3) existing.examples.push(desc);
    } else {
      buckets.set(key, {
        label,
        count: 1,
        totalAbs: Math.abs(line.amount),
        filingAction: c.suggestion.split(".")[0] ?? c.suggestion,
        examples: [desc],
      });
    }
  }

  return [...buckets.values()].sort((a, b) => b.count - a.count);
}

function compactDocLine(d: ReviewData["documents"][number]) {
  return {
    f: d.filename.split("/").pop(),
    t: d.documentType,
    cp: d.counterparty?.slice(0, 30),
    g: d.grossAmount,
    vr: d.vatRate,
    m: d.matched,
    w: d.warning?.slice(0, 40),
  };
}

function priorityDocuments(review: ReviewData) {
  const output = review.documents.filter(
    (d) =>
      d.documentType === "customer_invoice" ||
      d.documentType === "invoice_out" ||
      (d.grossAmount != null && d.grossAmount > 0),
  );
  const risky = review.documents.filter((d) => d.warning || d.grossAmount == null);
  const seen = new Set<string>();
  const merged: ReviewData["documents"] = [];

  for (const doc of [...output, ...risky, ...review.documents]) {
    if (seen.has(doc.id)) continue;
    seen.add(doc.id);
    merged.push(doc);
    if (merged.length >= 18) break;
  }

  return merged.map(compactDocLine);
}

export function buildOpeningMessage(review: ReviewData | null): string {
  if (!review) {
    return "Could not load this filing. Go back to uploads and try again.";
  }

  return `Ready for ${review.filingLabel}. Say what to fix in plain language — I'll update the numbers. When done, download ELSTER XML above.`;
}

/** Compact snapshot (~2–4k tokens). Use search_filing_data tool for line-level detail. */
export async function buildFilingContext(filingPeriodId: string): Promise<string | null> {
  const review = await getReviewData(filingPeriodId);
  if (!review) return null;

  const withAmount = review.documents.filter((d) => d.grossAmount != null);
  const withoutAmount = review.documents.filter((d) => d.grossAmount == null);
  const buckets = groupUnmatchedBank(review);

  return [
    `FILING: ${review.filingLabel} (${review.periodRange})`,
    `STATS: docs=${review.stats.documents} (${withAmount.length} w/ amounts, ${withoutAmount.length} missing) | bank=${review.stats.bankLines} | matched=${review.stats.matched} | unmatched_bank=${review.unmatchedBank.length}`,
    formatTriageForPrompt(review),
    `UNMATCHED BANK BUCKETS: ${JSON.stringify(buckets)}`,
    `PRIORITY DOCS: ${JSON.stringify(priorityDocuments(review))}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function searchFilingData(
  filingPeriodId: string,
  pattern: string,
  scope: "bank" | "documents" | "both" = "both",
  limit = 25,
): Promise<Record<string, unknown>> {
  const review = await getReviewData(filingPeriodId);
  if (!review) return { ok: false, message: "Filing not found" };

  const needle = pattern.trim().toLowerCase();
  if (!needle) return { ok: false, message: "Pattern required" };

  const matchesPattern = (text: string) => text.toLowerCase().includes(needle);

  const bank =
    scope === "documents"
      ? []
      : review.unmatchedBank
          .filter((line) =>
            matchesPattern(`${line.description ?? ""} ${line.counterparty ?? ""}`),
          )
          .slice(0, limit)
          .map((line) => {
            const c = classifyUnmatchedBankLine(line.description, line.counterparty, line.amount);
            return {
              id: line.id,
              date: line.date,
              amount: line.amount,
              description: line.description ?? line.counterparty,
              vatCase: c.vatCase,
              action: c.action,
            };
          });

  const documents =
    scope === "bank"
      ? []
      : review.documents
          .filter((d) =>
            matchesPattern(`${d.filename} ${d.counterparty ?? ""} ${d.warning ?? ""}`),
          )
          .slice(0, limit)
          .map(compactDocLine);

  return {
    ok: true,
    message: `Found ${bank.length} bank line(s), ${documents.length} document(s) matching "${pattern}".`,
    pattern,
    bankCount: bank.length,
    documentCount: documents.length,
    bank,
    documents,
  };
}
