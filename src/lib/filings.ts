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

function parseDateOnly(isoDate: string): Date {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateRange(start: string, end: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(parseDateOnly(start))} – ${fmt.format(parseDateOnly(end))}`;
}

const shortDeadlineFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
});

/** e.g. "10 Feb" */
export function formatShortDeadline(deadline: string): string {
  return shortDeadlineFmt.format(parseDateOnly(deadline));
}

export function daysUntilDeadline(deadline: string, now = new Date()): number {
  const due = parseDateOnly(deadline);
  due.setHours(23, 59, 59, 999);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

export type DeadlineTone = "overdue" | "soon" | "normal";

/** Red = overdue. Yellow = less than 30 days away. White = 30+ days. */
export function getDeadlineTone(deadline: string, now = new Date()): DeadlineTone {
  const daysLeft = daysUntilDeadline(deadline, now);
  if (daysLeft < 0) return "overdue";
  if (daysLeft < 30) return "soon";
  return "normal";
}
