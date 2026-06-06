-- fucktax Pro — ADD-ON (run after schema.sql)
-- Supabase Dashboard → SQL Editor → paste ALL of this file → Run
--
-- Adds: company profile/content tables, route_segment for filings, seed data.
-- IMPORTANT: Run from line 1 — filing_period sync at the top is not optional.
-- Or run supabase/sync-deadlines.sql alone to refresh filing_periods rows.

-- ---------------------------------------------------------------------------
-- Filing periods: URL segment (e.g. /jahresabschluss/2025)
-- ---------------------------------------------------------------------------

alter table public.filing_periods
  add column if not exists route_segment text;

update public.filing_periods
set route_segment = id
where route_segment is null;

update public.filing_periods
set route_segment = '2025'
where id in ('2025-ja', '2025-steuer');

alter table public.filing_periods
  alter column route_segment set not null;

alter table public.filing_periods
  add column if not exists sidebar_label text;

update public.filing_periods
set sidebar_label = label
where sidebar_label is null;

-- Sync deadlines + sidebar labels (safe to re-run)
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

-- ---------------------------------------------------------------------------
-- Company page content
-- ---------------------------------------------------------------------------

create table if not exists public.company_profile (
  id smallint primary key default 1 check (id = 1),
  name text not null,
  tagline text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.company_sections (
  id serial primary key,
  title text not null,
  sort_order integer not null,
  unique (sort_order)
);

create table if not exists public.company_lines (
  id serial primary key,
  section_id integer not null references public.company_sections (id) on delete cascade,
  kind text not null check (kind in ('text', 'data')),
  value text not null,
  sort_order integer not null,
  unique (section_id, sort_order)
);

create index if not exists company_lines_section_idx
  on public.company_lines (section_id, sort_order);

alter table public.company_profile enable row level security;
alter table public.company_sections enable row level security;
alter table public.company_lines enable row level security;

-- ---------------------------------------------------------------------------
-- Seed company profile + sections (re-runnable)
-- ---------------------------------------------------------------------------

insert into public.company_profile (id, name, tagline)
values (
  1,
  'HUGE Production GmbH',
  'GmbH · Dresden · HRB 46720'
)
on conflict (id) do update set
  name = excluded.name,
  tagline = excluded.tagline,
  updated_at = now();

delete from public.company_lines;
delete from public.company_sections;

insert into public.company_sections (id, title, sort_order) values
  (1, 'how a GmbH works', 10),
  (2, 'Körperschaftsteuer (Germany taxes)', 20),
  (3, 'Gewerbesteuer (Dresden Taxes)', 30),
  (4, 'Umsatzsteuer (VAT — Value Added Tax)', 40),
  (5, 'during the year', 50),
  (6, 'end of year', 60),
  (7, 'company', 70);

select setval(pg_get_serial_sequence('public.company_sections', 'id'), 7, true);

insert into public.company_lines (section_id, kind, value, sort_order) values
  (1, 'text', 'The company pays tax on profit.', 1),
  (1, 'text', 'Founders pay tax when money leaves the GmbH to you personally.', 2),
  (2, 'text', 'Tax on GmbH profit.', 1),
  (2, 'text', 'Körperschaftsteuer: 15% + Soli → 15.825% total.', 2),
  (3, 'text', 'Tax on GmbH profit.', 1),
  (3, 'text', 'Gewerbesteuer (Dresden): 15.75% on profit.', 2),
  (3, 'data', 'With Körperschaftsteuer → ~31.575% on profit.', 3),
  (4, 'text', 'We file quarterly.', 1),
  (4, 'text', 'Usually 19%, sometimes 7%, sometimes 0 — depends what we sell.', 2),
  (4, 'text', 'We collect VAT from customers. We pay VAT on purchases.', 3),
  (4, 'text', 'End of period: pay the difference to Finanzamt — or get a refund.', 4),
  (4, 'data', 'Steuernummer 202/110/00377', 5),
  (4, 'data', 'USt-ID DE455105120', 6),
  (5, 'text', 'Quarterly VAT filing (Umsatzsteuer-Voranmeldung)', 1),
  (6, 'text', 'Balance sheet + profit/loss (Jahresabschluss)', 1),
  (6, 'text', 'Körperschaftsteuererklärung', 2),
  (6, 'text', 'Gewerbesteuererklärung', 3),
  (6, 'text', 'Annual VAT return (USt-Jahreserklärung)', 4),
  (7, 'data', 'Sebnitzer Str. 35 · 01099 Dresden', 1),
  (7, 'data', 'Tadeus Mehl & Konstantin Saifoulline · 50/50', 2),
  (7, 'data', 'Share capital 25,000 EUR', 3),
  (7, 'data', 'Finanzamt Dresden Nord · BFN 3202', 4),
  (7, 'data', 'Mein ELSTER Username · HUGEProduction', 5),
  (7, 'data', 'Mein ELSTER Login Email · invite@hugeconversations.com', 6),
  (7, 'data', 'Finom · DE93 1001 8000 0392 6629 11', 7),
  (7, 'data', 'BIC FNOMDEB2', 8);
