-- Filing todos (invoice recovery + follow-up actions from chat)
-- Run after review-chat.sql

create table if not exists public.filing_todos (
  id uuid primary key default gen_random_uuid(),
  filing_period_id text not null references public.filing_periods (id) on delete cascade,
  text text not null,
  vendor text not null default '',
  pattern text not null default '',
  item_key text not null default '',
  kind text not null default 'action',
  status text not null default 'open'
    check (status in ('open', 'uploaded', 'not_found', 'done')),
  metadata jsonb not null default '{}'::jsonb,
  source_message_id uuid references public.review_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- Safe add for existing installs
alter table public.filing_todos add column if not exists item_key text not null default '';

create index if not exists filing_todos_filing_period_idx
  on public.filing_todos (filing_period_id, status, created_at desc);

create unique index if not exists filing_todos_dedupe_idx
  on public.filing_todos (filing_period_id, pattern, md5(text))
  where status = 'open';

create unique index if not exists filing_todos_item_key_open_idx
  on public.filing_todos (filing_period_id, item_key)
  where status = 'open' and item_key <> '';

alter table public.filing_todos enable row level security;
