import { classifyUnmatchedBankLine } from "@/lib/vat/classify-bank";
import { formatVatCasesForPrompt } from "@/lib/vat/cases";
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

export function buildOpeningMessage(review: ReviewData | null): string {
  if (!review) {
    return "I could not load filing data. Try re-running processing from the upload page.";
  }

  return `**${review.filingLabel}** — this is your **dedicated chat** for this quarter only.

Talk in plain language — I apply fixes and rebuild ELSTER. Use **+** to upload more invoices or bank files here.

**Priority:** output VAT you charged customers is **mandatory** (you owe Finanzamt). Input VAT we claim when valid — saves you money.

**Fast path:** **Download ELSTER XML** (top) → Mein ELSTER → XML Import.

Try: "Just make it work" or "Check we reported all customer invoices"`;
}

export async function buildFilingContext(filingPeriodId: string): Promise<string | null> {
  const review = await getReviewData(filingPeriodId);
  if (!review) return null;

  const withAmount = review.documents.filter((d) => d.grossAmount != null);
  const withoutAmount = review.documents.filter((d) => d.grossAmount == null);

  const bankClassified = review.unmatchedBank.slice(0, 50).map((line) => {
    const c = classifyUnmatchedBankLine(line.description, line.counterparty, line.amount);
    return {
      id: line.id,
      date: line.date,
      amount: line.amount,
      description: line.description ?? line.counterparty,
      vatCase: c.vatCase,
      suggestion: c.suggestion,
      action: c.action,
    };
  });

  const buckets = groupUnmatchedBank(review);

  const docLines = review.documents.slice(0, 35).map((d) => ({
    file: d.filename.split("/").pop(),
    type: d.documentType,
    counterparty: d.counterparty,
    gross: d.grossAmount,
    vatRate: d.vatRate,
    confidence: d.confidence,
    matched: d.matched,
    warning: d.warning,
  }));

  const outputDocs = review.documents.filter(
    (d) =>
      d.documentType === "customer_invoice" ||
      d.documentType === "invoice_out" ||
      (d.grossAmount != null && d.grossAmount > 0 && d.matched === false),
  );
  const incomingBank = review.unmatchedBank.filter((b) => b.amount > 500);

  return `
FILING: ${review.filingLabel} (${review.periodRange})

STATS:
- Documents: ${review.stats.documents} (${withAmount.length} with amounts, ${withoutAmount.length} missing amounts)
- Bank lines in period: ${review.stats.bankLines}
- Matched doc↔bank: ${review.stats.matched}
- Unmatched bank: ${review.unmatchedBank.length}

UNMATCHED BANK BUCKETS (recommended filing approach):
${JSON.stringify(buckets, null, 2)}

UNMATCHED BANK DETAIL (first 50):
${JSON.stringify(bankClassified, null, 2)}

OUTPUT VAT AUDIT (mandatory — you owe this to Finanzamt):
- Customer/output documents found: ${outputDocs.length}
- Large incoming bank payments without matched invoice: ${incomingBank.length}
${JSON.stringify(incomingBank.slice(0, 10), null, 2)}

DOCUMENTS (sample):
${JSON.stringify(docLines, null, 2)}

VAT CASE REFERENCE:
${formatVatCasesForPrompt()}
`.trim();
}
