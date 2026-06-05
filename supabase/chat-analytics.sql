-- fucktax Pro — full AI chat interaction logging (run after schema.sql + review-chat.sql)
-- Safe to re-run.
--
-- Purpose: track EVERY chat event for later analysis in Cursor:
--   npm run inspect:chats
-- Then in Cursor chat: "analyze the fucktax chat interactions"
--
-- Also query in Supabase SQL Editor:
--   select * from chat_interaction_logs order by created_at desc limit 100;

create table if not exists public.chat_interaction_logs (
  id uuid primary key default gen_random_uuid(),
  filing_period_id text not null references public.filing_periods (id) on delete cascade,
  upload_session_id uuid references public.upload_sessions (id) on delete set null,
  turn_id uuid,
  event_type text not null,
  role text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  duration_ms integer,
  success boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

comment on table public.chat_interaction_logs is
  'Full audit trail of VAT assistant chat — user messages, AI replies, tool calls, uploads, errors.';

comment on column public.chat_interaction_logs.turn_id is
  'Groups one user prompt + tool calls + assistant reply into a single exchange.';

comment on column public.chat_interaction_logs.event_type is
  'user_message | assistant_message | tool_call | tool_result | system_opening | smart_defaults | elster_refresh | process_incremental | client_upload | client_quick_prompt | client_elster_download | api_error';

create index if not exists chat_interaction_logs_filing_idx
  on public.chat_interaction_logs (filing_period_id, created_at desc);

create index if not exists chat_interaction_logs_turn_idx
  on public.chat_interaction_logs (turn_id, created_at);

create index if not exists chat_interaction_logs_event_type_idx
  on public.chat_interaction_logs (event_type, created_at desc);

alter table public.chat_interaction_logs enable row level security;

-- Enriched view for quick analysis (read in Supabase or inspect:chats script)
create or replace view public.chat_turns_summary as
select
  turn_id,
  filing_period_id,
  min(created_at) as started_at,
  max(created_at) as ended_at,
  max(duration_ms) filter (where event_type = 'assistant_message') as duration_ms,
  bool_or((metadata->>'elster_updated')::boolean) filter (where metadata ? 'elster_updated') as elster_updated,
  max((metadata->>'vat_payable')::numeric) filter (where metadata ? 'vat_payable') as vat_payable,
  count(*) filter (where event_type = 'tool_call') as tool_call_count,
  bool_and(success) as all_success,
  max(error_message) filter (where not success) as last_error,
  (array_agg(content order by created_at) filter (where event_type = 'user_message'))[1] as user_message,
  (array_agg(content order by created_at desc) filter (where event_type = 'assistant_message'))[1] as assistant_reply
from public.chat_interaction_logs
where turn_id is not null
group by turn_id, filing_period_id
order by started_at desc;
