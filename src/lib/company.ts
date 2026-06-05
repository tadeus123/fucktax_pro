export type CompanyNote = {
  title: string;
  lines: string[];
};

export const COMPANY = {
  name: "HUGE Production GmbH",
  tagline: "GmbH · Dresden",
};

export const COMPANY_NOTES: CompanyNote[] = [
  {
    title: "how a GmbH works",
    lines: [
      "The company pays tax on profit.",
      "Founders pay tax when money leaves the GmbH to you personally.",
    ],
  },
  {
    title: "Körperschaftsteuer",
    lines: [
      "Tax on GmbH profit.",
      "15% + Soli 0.825% → 15.825% total.",
    ],
  },
  {
    title: "Gewerbesteuer",
    lines: ["Dresden GmbH: 15.75% on profit."],
  },
  {
    title: "Umsatzsteuer",
    lines: [
      "We file quarterly.",
      "Usually 19%, sometimes 7%, sometimes 0 — depends what we sell.",
      "We collect VAT from customers. We pay VAT on purchases.",
      "End of period: pay the difference to Finanzamt — or get a refund.",
    ],
  },
  {
    title: "what Finanzamt expects",
    lines: [
      "Quarterly VAT filing",
      "Annual VAT return (USt-Jahreserklärung)",
      "Körperschaftsteuererklärung",
      "Gewerbesteuererklärung",
      "Balance sheet + profit/loss (Jahresabschluss)",
    ],
  },
  {
    title: "what to do first",
    lines: [
      "1. VAT filings (quarterly) — most urgent",
      "2. Jahresabschluss 2025",
      "3. Annual tax returns 2025 — by 31 Jul 2026",
    ],
  },
];
