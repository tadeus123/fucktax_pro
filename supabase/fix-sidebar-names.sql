-- Fix sidebar names only (run this if JA / Tax still show long titles)

alter table public.filing_periods
  add column if not exists sidebar_label text;

update public.filing_periods
set
  label = 'JA 2025',
  sidebar_label = 'JA 2025',
  updated_at = now()
where id = '2025-ja';

update public.filing_periods
set
  label = 'Tax 2025',
  sidebar_label = 'Tax 2025',
  updated_at = now()
where id = '2025-steuer';
