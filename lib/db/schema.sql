-- Horizon persistence schema.
-- Apply via:  psql $DATABASE_URL -f lib/db/schema.sql

create table if not exists sessions (
  id               text primary key,
  user_id          text,
  instance_url     text,
  access_token     text,
  refresh_token    text,
  issued_at        timestamptz not null default now(),
  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);

create table if not exists briefings (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  generated_at     timestamptz not null default now(),
  payload          jsonb not null,
  reasoning_trail  jsonb
);
create index if not exists briefings_user_generated_idx
  on briefings (user_id, generated_at desc);

create table if not exists preferences (
  user_id          text primary key,
  brief_time       text default '08:30',
  voice_enabled    boolean default true,
  tone             text default 'direct',
  updated_at       timestamptz not null default now()
);

create table if not exists approved_actions (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  draft            jsonb not null,
  approved_at      timestamptz not null default now(),
  result           jsonb
);
create index if not exists approved_actions_user_idx
  on approved_actions (user_id, approved_at desc);

-- v1.1-expansion: Ask My Data threads + messages.
-- Each thread is a multi-turn conversation over the self-hosted Data 360
-- MCP. Messages store the FULL content array (text + tool-use +
-- tool-result blocks) so the agent has prior MCP context on every turn —
-- storing only rendered text would force re-queries each turn.
create table if not exists ask_my_data_threads (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  title         text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  pinned        boolean not null default false
);
create index if not exists ask_my_data_threads_user_updated_idx
  on ask_my_data_threads (user_id, updated_at desc);

create table if not exists ask_my_data_messages (
  id            uuid primary key default gen_random_uuid(),
  thread_id     uuid not null references ask_my_data_threads(id) on delete cascade,
  role          text not null,
  content       jsonb not null,
  created_at    timestamptz not null default now()
);
create index if not exists ask_my_data_messages_thread_idx
  on ask_my_data_messages (thread_id, created_at);

-- v1.1-expansion / Tier 2 (Analyze): per-user, per-model "latest
-- analysis" — auto-loads when the banker returns to /analyze/[modelId].
-- Q-T2-3-b-detail = A: one row per (user, model), overwritten on each
-- new turn. Full history per model is deliberately out of scope.
create table if not exists analyze_latest (
  user_id        text not null,
  model_id       text not null,
  question       text not null,
  content        jsonb not null,  -- [{type:text|tool_use|tool_result, ...}]
  updated_at     timestamptz not null default now(),
  primary key (user_id, model_id)
);

-- 2026-05-06: scheduler credentials. Singleton row (id = 1, enforced by
-- check constraint) holding the refresh token of the LAST successful
-- banker login. Heroku Scheduler refresh jobs (refresh-dc-metadata,
-- refresh-tableau-sdms) read this row, exchange the refresh_token for
-- a fresh access token at job start, and run with that. "Last-good"
-- self-heals — if today's banker leaves, tomorrow's login takes over.
-- For prod-grade rollout, swap to a designated service-account refresh
-- token via SF_REFRESH_TOKEN config var (the scripts prefer env var
-- when set).
create table if not exists scheduler_credentials (
  id             smallint primary key default 1,
  refresh_token  text not null,
  instance_url   text not null,
  sf_user_id     text,
  updated_at     timestamptz not null default now(),
  constraint scheduler_credentials_singleton check (id = 1)
);

-- 2026-06-19: per-run token spend, summed per login session for the
-- right-rail Token Spend panel. session_id = hz_sid cookie. One row per
-- agent run; exact=false when counts were estimated (upstream omitted
-- usage). Fire-and-forget writes from the agent loop — never blocks a run.
create table if not exists token_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       text not null,
  session_id    text not null,
  route         text not null,
  model         text not null,
  input_tokens  integer not null,
  output_tokens integer not null,
  exact         boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists token_usage_session_idx
  on token_usage (session_id, created_at);
