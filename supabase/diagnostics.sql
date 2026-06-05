-- fucktax Pro — diagnostics / server event log (run once in SQL Editor)

create table if not exists public.app_events (
  id uuid primary key default gen_random_uuid(),
  level text not null check (level in ('info', 'warn', 'error')),
  source text not null,
  message text not null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_events_created_at_idx
  on public.app_events (created_at desc);

create index if not exists app_events_source_idx
  on public.app_events (source, created_at desc);

alter table public.app_events enable row level security;
