export type CompanyRow = {
  label: string;
  value: string;
  note?: string;
};

export type CompanySection = {
  title: string;
  rows: CompanyRow[];
};

export type CompanyDeadline = {
  label: string;
  date: string;
  alt?: string;
};

export const COMPANY = {
  name: "HUGE Production GmbH",
  tagline: "GmbH · Dresden · HRB 46720",
};

export const COMPANY_SECTIONS: CompanySection[] = [
  {
    title: "tax",
    rows: [
      { label: "Finanzamt", value: "Finanzamt Dresden Nord" },
      { label: "BFN", value: "3202" },
      { label: "Steuernummer", value: "202/110/00377" },
      { label: "USt-ID", value: "DE455105120" },
      { label: "VAT rhythm", value: "Quarterly" },
      { label: "Fiscal year", value: "Calendar year" },
      { label: "First tax year", value: "2025" },
    ],
  },
  {
    title: "legal",
    rows: [
      { label: "Address", value: "Sebnitzer Str. 35\n01099 Dresden" },
      { label: "Register", value: "AG Dresden · HRB 46720" },
      { label: "Share capital", value: "25,000 EUR" },
      {
        label: "Shareholders",
        value: "Tadeus Mehl 50%\nKonstantin Saifoulline 50%",
      },
    ],
  },
  {
    title: "rates",
    rows: [
      { label: "KSt + Soli", value: "15.825%" },
      { label: "GewSt Dresden", value: "15.75%" },
      {
        label: "Total profit tax",
        value: "31.575%",
        note: "Before dividend tax",
      },
    ],
  },
  {
    title: "people",
    rows: [
      { label: "Geschäftsführer", value: "Tadeus Mehl\nKonstantin Saifoulline" },
      { label: "Representation", value: "Einzelvertretung" },
    ],
  },
  {
    title: "payroll",
    rows: [
      { label: "Tadeus", value: "237 EUR gross + 263 EUR PKV" },
      { label: "Konstantin", value: "500 EUR gross" },
      { label: "Since", value: "01.07.2025" },
    ],
  },
  {
    title: "bank",
    rows: [
      { label: "Finom", value: "DE93 1001 8000 0392 6629 11" },
      { label: "BIC", value: "FNOMDEB2" },
    ],
  },
  {
    title: "annual filings 2025",
    rows: [
      { label: "Tax", value: "KSt · GewSt · USt-Jahreserklärung · E-Bilanz" },
      { label: "JA", value: "Bilanz · GuV · Anhang · Offenlegung" },
    ],
  },
];

export const COMPANY_DEADLINES: CompanyDeadline[] = [
  { label: "Q4 2025 VAT", date: "2026-01-12", alt: "10 Feb with extension" },
  { label: "Q1 2026 VAT", date: "2026-04-10", alt: "11 May with extension" },
  { label: "Q2 2026 VAT", date: "2026-07-10", alt: "10 Aug with extension" },
  { label: "JA 2025", date: "2026-06-30" },
  { label: "Tax 2025", date: "2026-07-31" },
  { label: "Publish 2025", date: "2026-12-31" },
];

export const COMPANY_MISSING = [
  "ELSTER access",
  "Dauerfristverlängerung",
  "Soll vs Ist-Versteuerung",
  "Last submitted VAT filing",
  "EORI number",
  "Accounting software",
  "PKV tax treatment (Tadeus)",
];
