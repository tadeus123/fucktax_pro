-- Chat history for VAT review assistant (run after schema.sql)
-- Safe to re-run: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

create table if not exists public.review_messages (
  id uuid primary key default gen_random_uuid(),
  filing_period_id text not null references public.filing_periods (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists review_messages_filing_period_idx
  on public.review_messages (filing_period_id, created_at);

alter table public.review_messages enable row level security;

-- Optional: persist bank line treatment from chat confirmations
alter table public.bank_transactions
  add column if not exists treatment_case text,
  add column if not exists treatment_note text,
  add column if not exists user_confirmed boolean not null default false;
