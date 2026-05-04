/**
 * Analyze per-user, per-model latest-analysis persistence.
 *
 * Q-T2-3-b-detail = A: one row per (user_id, model_id). Each turn
 * overwrites the row via upsert, so returning to /analyze/[modelId]
 * always renders the most recent analysis without a history.
 *
 * `content` stores the assistant's content-block array (text +
 * tool_use + tool_result + table_fallback) so the page can replay the
 * reasoning trail on reload. Mirrors the Ask My Data content shape
 * so the same UI primitives can render both.
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

export function isAnalyzeDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export type AnalyzeContentBlock = {
  type: string;
  [key: string]: unknown;
};

export type AnalyzeLatestRow = {
  user_id: string;
  model_id: string;
  question: string;
  content: AnalyzeContentBlock[];
  updated_at: string;
};

/**
 * Upsert the latest analysis for (user_id, model_id). Safe to call on
 * every turn — the primary key handles the replace.
 */
export async function upsertLatestAnalysis(input: {
  userId: string;
  modelId: string;
  question: string;
  content: AnalyzeContentBlock[];
}): Promise<void> {
  await pool().query(
    `insert into analyze_latest (user_id, model_id, question, content)
     values ($1, $2, $3, $4::jsonb)
     on conflict (user_id, model_id) do update set
       question = excluded.question,
       content = excluded.content,
       updated_at = now()`,
    [
      input.userId,
      input.modelId,
      input.question,
      JSON.stringify(input.content),
    ]
  );
}

/**
 * Fetch the most recent analysis for (user_id, model_id), or null when
 * the banker has never run an analysis on this model.
 */
export async function getLatestAnalysis(input: {
  userId: string;
  modelId: string;
}): Promise<AnalyzeLatestRow | null> {
  const { rows } = await pool().query<AnalyzeLatestRow>(
    `select user_id, model_id, question, content, updated_at
       from analyze_latest
      where user_id = $1 and model_id = $2`,
    [input.userId, input.modelId]
  );
  return rows[0] ?? null;
}

/**
 * Clear the latest analysis — used when the banker explicitly starts a
 * new analysis or the UI wants a fresh canvas.
 */
export async function clearLatestAnalysis(input: {
  userId: string;
  modelId: string;
}): Promise<void> {
  await pool().query(
    `delete from analyze_latest where user_id = $1 and model_id = $2`,
    [input.userId, input.modelId]
  );
}
