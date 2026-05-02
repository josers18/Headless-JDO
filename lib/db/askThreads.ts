/**
 * Ask My Data — thread + message persistence.
 *
 * Dedicated to the v1.1 expansion. Coexists with lib/db/queries.ts (the
 * Today path's DB layer) without sharing the connection pool wrapper —
 * both read the same Postgres via the `pg` module but keep their own
 * typed surfaces. That matches the "additive, not refactoring" rule.
 *
 * Schema: see `lib/db/schema.sql` (ask_my_data_threads + ask_my_data_messages).
 *
 * Message content MUST store the full content array (text + tool-use +
 * tool-result blocks). Storing only rendered text would force the agent
 * to re-query on every turn — a hard-won regression from the earlier
 * prototype surfaced in EXPANSION_v4's SETTLED DECISIONS.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
  });
  return _pool;
}

export type AskThreadRow = {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  pinned: boolean;
};

export type AskMessageRole = "user" | "assistant" | "tool" | "system";

/**
 * Content is persisted as a JSON array of blocks. The shape mirrors what
 * the agent loop serializes — strings are wrapped in `{type:"text",text}`,
 * tool calls are stored as the normalized Heroku-inference tool_call_complete
 * shape, tool results are stored as `{type:"tool_result",...}`. T1-2 does
 * not yet write to this table; T1-3 is the first writer.
 */
export type AskMessageContentBlock = {
  type: string;
  [key: string]: unknown;
};

export type AskMessageRow = {
  id: string;
  thread_id: string;
  role: AskMessageRole;
  content: AskMessageContentBlock[];
  created_at: string;
};

// ─── Thread operations ───────────────────────────────────────────────────

export async function createThread(input: {
  userId: string;
  title: string;
}): Promise<AskThreadRow> {
  const { rows } = await pool().query<AskThreadRow>(
    `insert into ask_my_data_threads (user_id, title)
     values ($1, $2)
     returning id, user_id, title, created_at, updated_at, pinned`,
    [input.userId, input.title]
  );
  const row = rows[0];
  if (!row) throw new Error("createThread: insert returned no row");
  return row;
}

export async function listThreads(input: {
  userId: string;
  limit?: number;
}): Promise<AskThreadRow[]> {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const { rows } = await pool().query<AskThreadRow>(
    `select id, user_id, title, created_at, updated_at, pinned
       from ask_my_data_threads
      where user_id = $1
      order by pinned desc, updated_at desc
      limit $2`,
    [input.userId, limit]
  );
  return rows;
}

export async function getThread(input: {
  id: string;
  userId: string;
}): Promise<AskThreadRow | null> {
  const { rows } = await pool().query<AskThreadRow>(
    `select id, user_id, title, created_at, updated_at, pinned
       from ask_my_data_threads
      where id = $1 and user_id = $2`,
    [input.id, input.userId]
  );
  return rows[0] ?? null;
}

export async function renameThread(input: {
  id: string;
  userId: string;
  title: string;
}): Promise<void> {
  await pool().query(
    `update ask_my_data_threads
        set title = $3, updated_at = now()
      where id = $1 and user_id = $2`,
    [input.id, input.userId, input.title]
  );
}

export async function touchThread(input: {
  id: string;
  userId: string;
}): Promise<void> {
  await pool().query(
    `update ask_my_data_threads
        set updated_at = now()
      where id = $1 and user_id = $2`,
    [input.id, input.userId]
  );
}

export async function deleteThread(input: {
  id: string;
  userId: string;
}): Promise<boolean> {
  // on delete cascade handles child messages.
  const { rowCount } = await pool().query(
    `delete from ask_my_data_threads where id = $1 and user_id = $2`,
    [input.id, input.userId]
  );
  return (rowCount ?? 0) > 0;
}

// ─── Message operations ───────────────────────────────────────────────────

export async function appendMessage(input: {
  threadId: string;
  role: AskMessageRole;
  content: AskMessageContentBlock[];
}): Promise<AskMessageRow> {
  const { rows } = await pool().query<AskMessageRow>(
    `insert into ask_my_data_messages (thread_id, role, content)
     values ($1, $2, $3::jsonb)
     returning id, thread_id, role, content, created_at`,
    [input.threadId, input.role, JSON.stringify(input.content)]
  );
  const row = rows[0];
  if (!row) throw new Error("appendMessage: insert returned no row");
  return row;
}

export async function listMessages(input: {
  threadId: string;
}): Promise<AskMessageRow[]> {
  const { rows } = await pool().query<AskMessageRow>(
    `select id, thread_id, role, content, created_at
       from ask_my_data_messages
      where thread_id = $1
      order by created_at asc`,
    [input.threadId]
  );
  return rows;
}
