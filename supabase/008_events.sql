-- v1.5: anonymous usage events.
-- Run this once in the Supabase SQL editor.
--
-- Two tables with the same shape:
--   events            real events written by /api/track
--   events_synthetic  fake sessions from scripts/analytics/seed-synthetic.mjs,
--                     kept apart so they can never mix into real results
--
-- Both are fully locked down: RLS on, no policies, anon/authenticated
-- revoked. Only the service-role key (server-side only) can read or write,
-- same approach as map_loads.
--
-- No IP addresses or user agents are stored. anon_id and session_id are
-- random per-tab ids (sessionStorage), not tied to a person.

create table if not exists events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  anon_id text not null,
  session_id text not null,
  event_name text not null,
  path text,
  properties jsonb not null default '{}'::jsonb
);
create index if not exists events_name_created_idx on events (event_name, created_at);
create index if not exists events_session_idx on events (session_id);

create table if not exists events_synthetic (like events including all);

alter table events enable row level security;
alter table events_synthetic enable row level security;

revoke all on events from anon, authenticated;
revoke all on events_synthetic from anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, delete on events to service_role;
grant select, insert, delete on events_synthetic to service_role;
