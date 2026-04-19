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
