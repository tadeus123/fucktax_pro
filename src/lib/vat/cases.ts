export type VatCaseId =
  | "de_supplier_19"
  | "de_supplier_7"
  | "de_customer_19"
  | "eu_b2b_supplier_rc"
  | "non_eu_service_rc"
  | "import_goods"
  | "eu_b2b_customer"
  | "non_eu_customer"
  | "restaurant_hospitality"
  | "private_mixed"
  | "payment_without_invoice";

export type VatCase = {
  id: VatCaseId;
  title: string;
  example: string;
  toolLogic: string;
  elsterHint?: string;
};

export const VAT_CASES: VatCase[] = [
  {
    id: "de_supplier_19",
    title: "German supplier invoice with 19% VAT",
    example: "1,000 € net + 190 € VAT = 1,190 €",
    toolLogic: "If valid and business-related: 190 € input VAT deductible.",
    elsterHint: "Vorsteuer 19%",
  },
  {
    id: "de_supplier_7",
    title: "German supplier invoice with 7% VAT",
    example: "100 € net + 7 € VAT = 107 €",
    toolLogic: "7 € input VAT deductible if business-related. Do not force 19%.",
    elsterHint: "Vorsteuer 7%",
  },
  {
    id: "de_customer_19",
    title: "German customer invoice with 19% VAT",
    example: "5,000 € net + 950 € VAT = 5,950 €",
    toolLogic: "950 € output VAT payable to Finanzamt.",
    elsterHint: "Umsatzsteuer 19%",
  },
  {
    id: "eu_b2b_supplier_rc",
    title: "EU B2B supplier invoice without VAT",
    example: "Irish SaaS: 100 € net, reverse charge note",
    toolLogic:
      "Usually reverse charge. Report German VAT owed and usually input VAT — often net zero but must be reported.",
    elsterHint: "§13b reverse charge",
  },
  {
    id: "non_eu_service_rc",
    title: "Non-EU software/service without VAT",
    example: "US software: 100 USD, no VAT",
    toolLogic:
      "Often reverse charge for services. No German VAT on invoice but German VAT may need self-assessment.",
    elsterHint: "§13b Dienstleistung Drittland",
  },
  {
    id: "import_goods",
    title: "Import of physical goods from outside EU",
    example: "Goods from China, no German VAT on supplier invoice",
    toolLogic:
      "No input VAT from supplier invoice. Import VAT from customs documents. Deductible if import VAT paid and documented.",
    elsterHint: "Einfuhrumsatzsteuer",
  },
  {
    id: "eu_b2b_customer",
    title: "EU B2B customer invoice",
    example: "Invoice French company with valid EU VAT ID: 5,000 € net, no DE VAT",
    toolLogic: "Usually no German VAT. Validate EU VAT ID. May need ZM (Zusammenfassende Meldung).",
    elsterHint: "Steuerfreie innergemeinschaftliche Lieferung",
  },
  {
    id: "non_eu_customer",
    title: "Non-EU customer invoice",
    example: "Invoice US company for services: 5,000 € net",
    toolLogic:
      "Often not taxable in Germany depending on service type. Flag for review — do not blindly add 19%.",
    elsterHint: "Nicht steuerbar / Ausfuhr",
  },
  {
    id: "restaurant_hospitality",
    title: "Restaurant / hospitality receipt",
    example: "Founder pays restaurant with company card",
    toolLogic:
      "VAT partly deductible if business meal documented (reason, participants, date). Otherwise flag risky.",
    elsterHint: "Bewirtung — 70% rule may apply",
  },
  {
    id: "private_mixed",
    title: "Private or mixed-use expense",
    example: "Clothing, private hotel, personal electronics",
    toolLogic: "Do not auto-deduct input VAT. Flag: business purpose unclear.",
  },
  {
    id: "payment_without_invoice",
    title: "Payment without invoice / invoice without payment",
    example: "Bank charge exists but no invoice uploaded",
    toolLogic:
      "For VAT, invoice timing matters more than payment. Bank is reconciliation only. No invoice = no input VAT yet. Suggest how to fix (request invoice, Kleinbetragsrechnung, or exclude).",
  },
];

export function getVatCase(id: string): VatCase | undefined {
  return VAT_CASES.find((c) => c.id === id);
}

export function formatVatCasesForPrompt(): string {
  return VAT_CASES.map(
    (c, i) =>
      `${i + 1}. ${c.id}: ${c.title}\n   Example: ${c.example}\n   Logic: ${c.toolLogic}`,
  ).join("\n\n");
}
