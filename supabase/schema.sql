-- fucktax Pro — Supabase setup
-- Run in Supabase Dashboard → SQL Editor → New query → Run
--
-- Access model: private app (site password on Vercel).
-- Next.js API routes use SUPABASE_SERVICE_ROLE_KEY (bypasses RLS).
-- Do not expose the service role / secret key to the browser.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type public.filing_type as enum ('vat', 'jahresabschluss', 'steuer');

create type public.filing_status as enum ('open', 'in_progress', 'done');

create type public.upload_kind as enum ('document', 'bank');

create type public.confidence_level as enum ('safe', 'likely', 'review', 'do_not_deduct');

create type public.processing_status as enum (
  'pending',
  'processing',
  'done',
  'failed',
  'needs_review'
);

-- ---------------------------------------------------------------------------
-- Filing periods (sidebar menu items)
-- ---------------------------------------------------------------------------

create table public.filing_periods (
  id text primary key,
  filing_type public.filing_type not null,
  label text not null,
  sidebar_label text,
  period_start date,
  period_end date,
  period_label text,
  deadline date not null,
  deadline_label text not null,
  status public.filing_status not null default 'open',
  description text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index filing_periods_type_sort_idx
  on public.filing_periods (filing_type, sort_order);

-- ---------------------------------------------------------------------------
-- Upload session per filing period (one active workflow at a time)
-- ---------------------------------------------------------------------------

create table public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  filing_period_id text not null references public.filing_periods (id) on delete restrict,
  status public.processing_status not null default 'pending',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index upload_sessions_filing_period_idx
  on public.upload_sessions (filing_period_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Uploaded files (metadata; bytes live in Storage)
-- ---------------------------------------------------------------------------

create table public.uploaded_files (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.upload_sessions (id) on delete cascade,
  kind public.upload_kind not null,
  storage_bucket text not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text,
  processing_status public.processing_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create index uploaded_files_session_kind_idx
  on public.uploaded_files (session_id, kind);

-- ---------------------------------------------------------------------------
-- AI extraction + VAT classification (one row per document)
-- ---------------------------------------------------------------------------

create table public.document_records (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.uploaded_files (id) on delete cascade,
  filing_period_id text references public.filing_periods (id) on delete set null,
  document_type text,
  counterparty_name text,
  invoice_number text,
  invoice_date date,
  leistungsdatum date,
  payment_date date,
  net_amount numeric(14, 2),
  vat_rate numeric(5, 2),
  vat_amount numeric(14, 2),
  gross_amount numeric(14, 2),
  currency text not null default 'EUR',
  country text,
  vat_id text,
  reverse_charge_text text,
  counterparty_type text,
  vat_shown text,
  vat_treatment text,
  quarter_assignment text,
  confidence public.confidence_level,
  warning text,
  risk_status text,
  raw_extraction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index document_records_filing_period_idx
  on public.document_records (filing_period_id);

create index document_records_confidence_idx
  on public.document_records (confidence);

-- ---------------------------------------------------------------------------
-- Parsed bank transactions (reconciliation)
-- ---------------------------------------------------------------------------

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.upload_sessions (id) on delete cascade,
  source_file_id uuid references public.uploaded_files (id) on delete set null,
  transaction_date date not null,
  value_date date,
  amount numeric(14, 2) not null,
  currency text not null default 'EUR',
  description text,
  counterparty text,
  reference text,
  matched_document_id uuid references public.document_records (id) on delete set null,
  reconciliation_status text not null default 'unmatched',
  created_at timestamptz not null default now()
);

create index bank_transactions_session_date_idx
  on public.bank_transactions (session_id, transaction_date);

-- ---------------------------------------------------------------------------
-- VAT period totals (mapped to ELSTER fields later)
-- ---------------------------------------------------------------------------

create table public.vat_summaries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.upload_sessions (id) on delete cascade,
  filing_period_id text not null references public.filing_periods (id) on delete restrict,
  output_vat_19 numeric(14, 2) not null default 0,
  output_vat_7 numeric(14, 2) not null default 0,
  input_vat_deductible numeric(14, 2) not null default 0,
  input_vat_non_deductible numeric(14, 2) not null default 0,
  reverse_charge_output numeric(14, 2) not null default 0,
  reverse_charge_input numeric(14, 2) not null default 0,
  vat_payable numeric(14, 2) not null default 0,
  elster_field_map jsonb not null default '{}'::jsonb,
  xml_storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id)
);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger filing_periods_set_updated_at
  before update on public.filing_periods
  for each row execute function public.set_updated_at();

create trigger upload_sessions_set_updated_at
  before update on public.upload_sessions
  for each row execute function public.set_updated_at();

create trigger document_records_set_updated_at
  before update on public.document_records
  for each row execute function public.set_updated_at();

create trigger vat_summaries_set_updated_at
  before update on public.vat_summaries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Seed filing periods (Supabase is the app source of truth)
-- ---------------------------------------------------------------------------

insert into public.filing_periods (
  id,
  filing_type,
  label,
  sidebar_label,
  period_start,
  period_end,
  period_label,
  deadline,
  deadline_label,
  status,
  description,
  sort_order
) values
  (
    'q4-2025',
    'vat',
    'Q4 2025',
    'Q4 2025',
    '2025-10-01',
    '2025-12-31',
    null,
    '2026-01-12',
    'Due 12 Jan 2026',
    'open',
    null,
    10
  ),
  (
    'q1-2026',
    'vat',
    'Q1 2026',
    'Q1 2026',
    '2026-01-01',
    '2026-03-31',
    null,
    '2026-04-10',
    'Due 10 Apr 2026',
    'open',
    null,
    20
  ),
  (
    'q2-2026',
    'vat',
    'Q2 2026',
    'Q2 2026',
    '2026-04-01',
    '2026-06-30',
    null,
    '2026-07-10',
    'Due 10 Jul 2026',
    'open',
    null,
    30
  ),
  (
    '2025-ja',
    'jahresabschluss',
    'Jahresabschluss 2025',
    'JA 2025',
    '2025-01-01',
    '2025-12-31',
    'Geschäftsjahr 2025 (1 Jan – 31 Dec)',
    '2026-06-30',
    'Due 30 Jun 2026',
    'open',
    'Annual financial statements for 2025.',
    40
  ),
  (
    '2025-steuer',
    'steuer',
    'Annual tax return 2025',
    'Tax 2025',
    null,
    null,
    'Veranlagung 2025',
    '2026-07-31',
    'Due 31 Jul 2026',
    'open',
    'Körperschaftsteuer / Gewerbesteuer / ESt if applicable.',
    50
  )
on conflict (id) do update set
  label = excluded.label,
  sidebar_label = excluded.sidebar_label,
  period_start = excluded.period_start,
  period_end = excluded.period_end,
  period_label = excluded.period_label,
  deadline = excluded.deadline,
  deadline_label = excluded.deadline_label,
  status = excluded.status,
  description = excluded.description,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Storage buckets (private — server uploads via service role only)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values
  ('documents', 'documents', false, 52428800),
  ('bank-extracts', 'bank-extracts', false, 52428800)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- service_role bypasses RLS; anon/authenticated have no direct access
-- ---------------------------------------------------------------------------

alter table public.filing_periods enable row level security;
alter table public.upload_sessions enable row level security;
alter table public.uploaded_files enable row level security;
alter table public.document_records enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.vat_summaries enable row level security;

-- storage.objects: RLS is already enabled by Supabase — do not alter it here
-- (SQL editor is not owner of that table → ERROR 42501).
-- Private buckets above + no anon policies = server-only access via service role.

-- Optional read-only policy if you later add Supabase Auth users:
-- create policy "authenticated read filing periods"
--   on public.filing_periods for select
--   to authenticated
--   using (true);
