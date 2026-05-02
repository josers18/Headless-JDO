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
