export type CompanyLine =
  | { kind: "text"; value: string }
  | { kind: "data"; value: string };

export type CompanyNote = {
  title: string;
  lines: CompanyLine[];
};

export const COMPANY = {
  name: "HUGE Production GmbH",
  tagline: "GmbH · Dresden · HRB 46720",
};

export const COMPANY_NOTES: CompanyNote[] = [
  {
    title: "how a GmbH works",
    lines: [
      { kind: "text", value: "The company pays tax on profit." },
      {
        kind: "text",
        value: "Founders pay tax when money leaves the GmbH to you personally.",
      },
    ],
  },
  {
    title: "Körperschaftsteuer (Germany taxes)",
    lines: [
      { kind: "text", value: "Tax on GmbH profit." },
      { kind: "text", value: "15% + Soli 0.825% → 15.825% total." },
    ],
  },
  {
    title: "Gewerbesteuer (Dresden Taxes)",
    lines: [
      { kind: "text", value: "Dresden GmbH: 15.75% on profit." },
      {
        kind: "data",
        value: "With Körperschaftsteuer → ~31.575% on profit (before dividends)",
      },
    ],
  },
  {
    title: "Umsatzsteuer (VAT — Value Added Tax)",
    lines: [
      { kind: "text", value: "We file quarterly." },
      {
        kind: "text",
        value: "Usually 19%, sometimes 7%, sometimes 0 — depends what we sell.",
      },
      {
        kind: "text",
        value: "We collect VAT from customers. We pay VAT on purchases.",
      },
      {
        kind: "text",
        value: "End of period: pay the difference to Finanzamt — or get a refund.",
      },
      { kind: "data", value: "Steuernummer 202/110/00377" },
      { kind: "data", value: "USt-ID DE455105120" },
    ],
  },
  {
    title: "during the year",
    lines: [
      { kind: "text", value: "Quarterly VAT filing (Umsatzsteuer-Voranmeldung)" },
    ],
  },
  {
    title: "end of year",
    lines: [
      { kind: "text", value: "Balance sheet + profit/loss (Jahresabschluss)" },
      { kind: "text", value: "Körperschaftsteuererklärung" },
      { kind: "text", value: "Gewerbesteuererklärung" },
      { kind: "text", value: "Annual VAT return (USt-Jahreserklärung)" },
    ],
  },
  {
    title: "company",
    lines: [
      { kind: "data", value: "Sebnitzer Str. 35 · 01099 Dresden" },
      { kind: "data", value: "Tadeus Mehl & Konstantin Saifoulline · 50/50" },
      { kind: "data", value: "Share capital 25,000 EUR" },
      { kind: "data", value: "Finanzamt Dresden Nord · BFN 3202" },
      { kind: "data", value: "Finom · DE93 1001 8000 0392 6629 11" },
      { kind: "data", value: "BIC FNOMDEB2" },
    ],
  },
];
