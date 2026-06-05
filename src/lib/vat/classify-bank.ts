import type { VatCaseId } from "@/lib/vat/cases";

export type BankLineClassification = {
  vatCase: VatCaseId | "internal_transfer" | "unknown";
  suggestion: string;
  action: "ignore" | "need_invoice" | "reverse_charge" | "review" | "match_receipt";
  priority: "low" | "medium" | "high";
};

function haystack(description: string | null, counterparty: string | null): string {
  return `${description ?? ""} ${counterparty ?? ""}`.toLowerCase();
}

export function classifyUnmatchedBankLine(
  description: string | null,
  counterparty: string | null,
  amount: number,
): BankLineClassification {
  const text = haystack(description, counterparty);

  if (
    text.includes("transfer to another wallet") ||
    text.includes("transfer from another wallet") ||
    (text.includes("transfer") && Math.abs(amount) < 200)
  ) {
    return {
      vatCase: "internal_transfer",
      suggestion: "Internal wallet movement — exclude from VAT return.",
      action: "ignore",
      priority: "low",
    };
  }

  if (text.includes("huge production") && amount > 0) {
    return {
      vatCase: "de_customer_19",
      suggestion: "Incoming payment — likely customer revenue. Match to outgoing invoice if issued this quarter.",
      action: "review",
      priority: "medium",
    };
  }

  if (
    text.includes("notion") ||
    text.includes("cursor") ||
    text.includes("snap inc") ||
    text.includes("steam") ||
    text.includes("paddle") ||
    text.includes("stripe")
  ) {
    return {
      vatCase: "non_eu_service_rc",
      suggestion:
        "US/international SaaS — reverse charge from bank amount after user confirms. Invoice PDF optional (vendor portal).",
      action: "reverse_charge",
      priority: "medium",
    };
  }

  if (
    text.includes("safeway") ||
    text.includes("walgreens") ||
    text.includes("ben & jerry") ||
    text.includes("produce market") ||
    text.includes("beach chalet")
  ) {
    return {
      vatCase: "private_mixed",
      suggestion:
        "US retail receipt — usually no German Vorsteuer. If truly business (e.g. shoot travel), keep receipt + business note; otherwise exclude from DE VAT.",
      action: "review",
      priority: "medium",
    };
  }

  if (text.includes("clipper") || text.includes("transit") || text.includes("fare")) {
    return {
      vatCase: "private_mixed",
      suggestion: "Local transport — business if documented work trip; otherwise private.",
      action: "review",
      priority: "low",
    };
  }

  if (text.includes("tadeus") || text.includes("mehl")) {
    return {
      vatCase: "internal_transfer",
      suggestion: "Personal transfer — likely reimbursement or private; not a supplier invoice.",
      action: "review",
      priority: "medium",
    };
  }

  if (text.includes("amazon") && amount < 0) {
    return {
      vatCase: "payment_without_invoice",
      suggestion: "Amazon purchase — download invoice from Amazon Business / order history.",
      action: "need_invoice",
      priority: "high",
    };
  }

  if (amount > 0) {
    return {
      vatCase: "payment_without_invoice",
      suggestion: "Incoming payment — match to customer invoice or classify as non-VAT (loan, refund, etc.).",
      action: "review",
      priority: "medium",
    };
  }

  return {
    vatCase: "payment_without_invoice",
    suggestion:
      "No matching invoice — for Vorsteuer you need a valid Beleg. Options: (1) upload missing invoice, (2) request from vendor, (3) mark as non-deductible/private, (4) Kleinbetragsrechnung if ≤250 € and receipt shows required fields.",
    action: "need_invoice",
    priority: "high",
  };
}
