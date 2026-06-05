-- fucktax Pro — sync filing deadlines (safe to re-run)
-- Run in Supabase SQL Editor if sidebar shows old dates (e.g. 10 Feb, 31 Mar).

update public.filing_periods set
  deadline = '2026-01-12',
  deadline_label = 'Due 12 Jan 2026',
  updated_at = now()
where id = 'q4-2025';

update public.filing_periods set
  deadline = '2026-04-10',
  deadline_label = 'Due 10 Apr 2026',
  updated_at = now()
where id = 'q1-2026';

update public.filing_periods set
  deadline = '2026-07-10',
  deadline_label = 'Due 10 Jul 2026',
  updated_at = now()
where id = 'q2-2026';

update public.filing_periods set
  deadline = '2026-06-30',
  deadline_label = 'Due 30 Jun 2026',
  updated_at = now()
where id = '2025-ja';

update public.filing_periods set
  deadline = '2026-07-31',
  deadline_label = 'Due 31 Jul 2026',
  updated_at = now()
where id = '2025-steuer';
