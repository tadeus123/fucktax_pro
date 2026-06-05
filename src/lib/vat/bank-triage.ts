import { classifyUnmatchedBankLine } from "@/lib/vat/classify-bank";
import type { ReviewData } from "@/lib/supabase/queries";

export type RecoveryOpportunity = {
  pattern: string;
  label: string;
  count: number;
  totalAbs: number;
  estRecoveryEur: number;
  kind:
    | "input_vat_invoice"
    | "rc_from_bank"
    | "output_invoice"
    | "receipt_or_photo"
    | "auto_exclude";
  askUser: boolean;
  examples: Array<{ date: string; amount: number; text: string }>;
  hint: string;
};

export type UnlinkedDocument = {
  file: string;
  counterparty: string | null;
  warning: string | null;
  likelyBankMatch: string | null;
  hint: string;
};

const IMAGE_EXT = /\.(jpe?g|png|heic|webp|gif)$/i;

function vendorPattern(text: string): string {
  const t = text.toLowerCase().trim();
  const vendors = [
    "cursor",
    "notion",
    "amazon",
    "paddle",
    "stripe",
    "snap inc",
    "steam",
    "safeway",
    "walgreens",
    "transfer to another wallet",
    "transfer from another wallet",
  ];
  for (const v of vendors) {
    if (t.includes(v)) return v;
  }
  const words = t.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  return words.slice(0, 2).join(" ") || t.slice(0, 24);
}

function estimateRecoveryEur(
  amount: number,
  kind: RecoveryOpportunity["kind"],
): number {
  const abs = Math.abs(amount);
  if (kind === "auto_exclude" || kind === "output_invoice") return 0;
  if (kind === "rc_from_bank") return 0;
  if (kind === "receipt_or_photo") return abs <= 250 ? roundEuro(abs * 0.19 / 1.19) : roundEuro(abs * 0.19 / 1.19);
  return roundEuro((abs / 1.19) * 0.19);
}

function roundEuro(n: number): number {
  return Math.round(n * 100) / 100;
}

function kindFromClassification(
  c: ReturnType<typeof classifyUnmatchedBankLine>,
  amount: number,
): RecoveryOpportunity["kind"] {
  if (c.action === "ignore" || c.vatCase === "internal_transfer" || c.vatCase === "private_mixed") {
    return "auto_exclude";
  }
  if (c.vatCase === "de_customer_19") return "output_invoice";
  if (
    c.vatCase === "non_eu_service_rc" ||
    c.vatCase === "eu_b2b_supplier_rc" ||
    c.action === "reverse_charge"
  ) {
    return "rc_from_bank";
  }
  if (c.vatCase === "de_supplier_19" || c.vatCase === "de_supplier_7") return "input_vat_invoice";
  if (c.action === "need_invoice" && Math.abs(amount) <= 250) return "receipt_or_photo";
  if (c.action === "need_invoice") return "input_vat_invoice";
  if (amount > 500 && amount > 0) return "output_invoice";
  return "auto_exclude";
}

export function buildRecoveryOpportunities(review: ReviewData): RecoveryOpportunity[] {
  const groups = new Map<string, RecoveryOpportunity>();

  for (const line of review.unmatchedBank) {
    const text = `${line.description ?? ""} ${line.counterparty ?? ""}`.trim();
    const c = classifyUnmatchedBankLine(line.description, line.counterparty, line.amount);
    const kind = kindFromClassification(c, line.amount);
    const pattern = vendorPattern(text);
    const key = `${kind}:${pattern}`;

    const est = estimateRecoveryEur(line.amount, kind);
    const askUser =
      kind === "input_vat_invoice" ||
      kind === "receipt_or_photo" ||
      (kind === "output_invoice" && line.amount > 500) ||
      (kind === "rc_from_bank" && Math.abs(line.amount) >= 200);

    const label =
      kind === "input_vat_invoice"
        ? "Missing invoice — Vorsteuer at risk"
        : kind === "rc_from_bank"
          ? "SaaS / reverse charge — bank OK if you confirm"
          : kind === "output_invoice"
            ? "Customer payment — output VAT check"
            : kind === "receipt_or_photo"
              ? "Small payment — receipt photo may be enough"
              : "Auto-exclude (no recovery)";

    const hint =
      kind === "input_vat_invoice"
        ? "Ask user to upload PDF invoice — saves real Vorsteuer."
        : kind === "rc_from_bank"
          ? "No PDF needed if user confirms — use confirm_bank_lines_matching with bank amount."
        : kind === "output_invoice"
          ? "Ask for customer invoice only if output VAT not already filed."
          : kind === "receipt_or_photo"
            ? "Check uploads for photo/receipt; Kleinbetragsrechnung if ≤250 €."
            : "Exclude silently via tools — do not ask user.";

    const existing = groups.get(key);
    const example = {
      date: line.date,
      amount: line.amount,
      text: text.slice(0, 55),
    };

    if (existing) {
      existing.count += 1;
      existing.totalAbs += Math.abs(line.amount);
      existing.estRecoveryEur += est;
      if (existing.examples.length < 3) existing.examples.push(example);
    } else {
      groups.set(key, {
        pattern,
        label,
        count: 1,
        totalAbs: Math.abs(line.amount),
        estRecoveryEur: est,
        kind,
        askUser,
        examples: [example],
        hint,
      });
    }
  }

  return [...groups.values()]
    .sort((a, b) => {
      if (a.askUser !== b.askUser) return a.askUser ? -1 : 1;
      return b.estRecoveryEur - a.estRecoveryEur;
    });
}

function filenameMightMatchBank(
  filename: string,
  counterparty: string | null,
  bankText: string,
): boolean {
  const hay = `${filename} ${counterparty ?? ""}`.toLowerCase();
  const bank = bankText.toLowerCase();
  const tokens = bank.split(/\s+/).filter((w) => w.length > 3);
  return tokens.some((t) => hay.includes(t));
}

export function findUnlinkedDocuments(review: ReviewData): UnlinkedDocument[] {
  const unmatchedTexts = review.unmatchedBank.map(
    (b) => `${b.description ?? ""} ${b.counterparty ?? ""}`,
  );

  return review.documents
    .filter((d) => !d.matched && (d.grossAmount == null || d.warning || IMAGE_EXT.test(d.filename)))
    .slice(0, 20)
    .map((d) => {
      const file = d.filename.split("/").pop() ?? d.filename;
      const isImage = IMAGE_EXT.test(d.filename);
      let likelyBankMatch: string | null = null;

      for (const text of unmatchedTexts) {
        if (filenameMightMatchBank(file, d.counterparty, text)) {
          likelyBankMatch = text.slice(0, 50);
          break;
        }
      }

      const hint = isImage
        ? "Photo upload — may pair with a bank line; extract amounts or ask user."
        : d.grossAmount == null
          ? "PDF without amounts — re-check extraction or match to bank payment."
          : "Unmatched to bank — verify counterparty/amount.";

      return {
        file,
        counterparty: d.counterparty,
        warning: d.warning,
        likelyBankMatch,
        hint,
      };
    });
}

export function formatTriageForPrompt(review: ReviewData): string {
  const opportunities = buildRecoveryOpportunities(review);
  const askList = opportunities.filter((o) => o.askUser).slice(0, 12);
  const autoList = opportunities.filter((o) => !o.askUser && o.kind === "auto_exclude").slice(0, 5);
  const unlinked = findUnlinkedDocuments(review);

  const totalAskRecovery = roundEuro(askList.reduce((s, o) => s + o.estRecoveryEur, 0));

  return [
    `BANK TRIAGE: ${review.unmatchedBank.length} unmatched lines — most have no invoice (normal).`,
    `Ask user ONLY for ${askList.length} group(s) (~€${totalAskRecovery.toFixed(2)} potential Vorsteuer). Auto-handle the rest from bank.`,
    askList.length ? `ASK USER (grouped, max 1 message): ${JSON.stringify(askList)}` : "ASK USER: nothing urgent — file from bank + uploaded docs.",
    autoList.length ? `AUTO EXCLUDE (no question): ${JSON.stringify(autoList.map((o) => ({ pattern: o.pattern, count: o.count })))}` : "",
    unlinked.length ? `UNLINKED DOCS (photos/PDFs w/o match): ${JSON.stringify(unlinked.slice(0, 10))}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function getRecoveryOpportunities(filingPeriodId: string): Promise<Record<string, unknown>> {
  const { getReviewData } = await import("@/lib/supabase/queries");
  const review = await getReviewData(filingPeriodId);
  if (!review) return { ok: false, message: "Filing not found" };

  const opportunities = buildRecoveryOpportunities(review);
  const unlinked = findUnlinkedDocuments(review);

  return {
    ok: true,
    message: `${opportunities.filter((o) => o.askUser).length} group(s) worth asking about.`,
    askUser: opportunities.filter((o) => o.askUser),
    autoExclude: opportunities.filter((o) => o.kind === "auto_exclude"),
    rcFromBank: opportunities.filter((o) => o.kind === "rc_from_bank"),
    unlinkedDocuments: unlinked,
  };
}
