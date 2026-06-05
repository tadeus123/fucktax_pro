export type FilingStatus = "open" | "in_progress" | "done";

export type VatFiling = {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  deadline: string;
  deadlineLabel: string;
  status: FilingStatus;
};

export type GenericFiling = {
  id: string;
  label: string;
  periodLabel: string;
  deadline: string;
  deadlineLabel: string;
  status: FilingStatus;
  description: string;
};

export const VAT_FILINGS: VatFiling[] = [
  {
    id: "q4-2025",
    label: "Q4 2025",
    periodStart: "2025-10-01",
    periodEnd: "2025-12-31",
    deadline: "2026-01-12",
    deadlineLabel: "Due 12 Jan 2026",
    status: "open",
  },
  {
    id: "q1-2026",
    label: "Q1 2026",
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    deadline: "2026-04-10",
    deadlineLabel: "Due 10 Apr 2026",
    status: "open",
  },
  {
    id: "q2-2026",
    label: "Q2 2026",
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    deadline: "2026-07-10",
    deadlineLabel: "Due 10 Jul 2026",
    status: "open",
  },
];

export const JAHRESABSCHLUSS: GenericFiling[] = [
  {
    id: "2025",
    label: "Jahresabschluss 2025",
    periodLabel: "Geschäftsjahr 2025 (1 Jan – 31 Dec)",
    deadline: "2026-06-30",
    deadlineLabel: "Due 30 Jun 2026",
    status: "open",
    description: "Annual financial statements for 2025.",
  },
];

export const STEUERERKLAERUNG: GenericFiling[] = [
  {
    id: "2025",
    label: "Annual tax return 2025",
    periodLabel: "Veranlagung 2025",
    deadline: "2026-07-31",
    deadlineLabel: "Due 31 Jul 2026",
    status: "open",
    description: "Körperschaftsteuer / Gewerbesteuer / ESt if applicable.",
  },
];

export function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(new Date(start))} – ${fmt.format(new Date(end))}`;
}

export function getVatFiling(id: string): VatFiling | undefined {
  return VAT_FILINGS.find((f) => f.id === id);
}

const shortDeadlineFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** e.g. "10 Feb" */
export function formatShortDeadline(deadline: string): string {
  return shortDeadlineFmt.format(new Date(deadline));
}

/** Red when overdue or within 21 days. */
export function isDeadlineUrgent(deadline: string, now = new Date()): boolean {
  const due = new Date(deadline);
  due.setHours(23, 59, 59, 999);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const msPerDay = 86400000;
  const daysLeft = Math.ceil((due.getTime() - today.getTime()) / msPerDay);
  return daysLeft <= 21;
}

export const DOCUMENT_UPLOAD_HINTS = [
  "Customer invoices",
  "Supplier invoices",
  "Receipts",
  "Import / customs documents",
  "Contracts, loan agreements, travel docs — anything relevant",
];

export const BANK_UPLOAD_HINTS = [
  "CSV or PDF export from your bank",
  "All business account transactions in the period",
  "Used to match payments to invoices (reconciliation)",
];
