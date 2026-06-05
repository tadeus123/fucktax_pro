-- fucktax Pro — sync filing_periods (deadlines + sidebar labels)
-- Run in Supabase SQL Editor. Safe to re-run.

alter table public.filing_periods
  add column if not exists sidebar_label text;

update public.filing_periods
set sidebar_label = label
where sidebar_label is null;

update public.filing_periods set
  label = 'Q4 2025',
  sidebar_label = 'Q4 2025',
  deadline = '2026-01-12',
  deadline_label = 'Due 12 Jan 2026',
  updated_at = now()
where id = 'q4-2025';

update public.filing_periods set
  label = 'Q1 2026',
  sidebar_label = 'Q1 2026',
  deadline = '2026-04-10',
  deadline_label = 'Due 10 Apr 2026',
  updated_at = now()
where id = 'q1-2026';

update public.filing_periods set
  label = 'Q2 2026',
  sidebar_label = 'Q2 2026',
  deadline = '2026-07-10',
  deadline_label = 'Due 10 Jul 2026',
  updated_at = now()
where id = 'q2-2026';

update public.filing_periods set
  label = 'JA 2025',
  sidebar_label = 'JA 2025',
  deadline = '2026-06-30',
  deadline_label = 'Due 30 Jun 2026',
  updated_at = now()
where id = '2025-ja';

update public.filing_periods set
  label = 'Tax 2025',
  sidebar_label = 'Tax 2025',
  deadline = '2026-07-31',
  deadline_label = 'Due 31 Jul 2026',
  updated_at = now()
where id = '2025-steuer';
