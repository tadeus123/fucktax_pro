export type CompanyRow = {
  label: string;
  value: string;
  note?: string;
};

export type CompanySection = {
  title: string;
  rows: CompanyRow[];
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
      { label: "Total profit tax", value: "31.575%" },
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
