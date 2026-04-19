import { Pool } from "pg";
import type { MorningBrief, ReasoningStep } from "@/types/horizon";

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: url,
    // Heroku Postgres requires SSL. Node's default cert chain doesn't include
    // Heroku's internal CA, so we skip cert verification on the server side.
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
  });
  return _pool;
}

export async function saveBriefing(
  userId: string,
  brief: MorningBrief,
  reasoning: ReasoningStep[]
): Promise<string> {
  const { rows } = await pool().query<{ id: string }>(
    `insert into briefings (user_id, payload, reasoning_trail)
     values ($1, $2::jsonb, $3::jsonb)
     returning id`,
    [userId, JSON.stringify(brief), JSON.stringify(reasoning)]
  );
  const row = rows[0];
  if (!row) throw new Error("saveBriefing: insert returned no row");
  return row.id;
}

export async function latestBriefing(
  userId: string
): Promise<MorningBrief | null> {
  const { rows } = await pool().query<{ payload: MorningBrief }>(
    `select payload from briefings
     where user_id = $1
     order by generated_at desc
     limit 1`,
    [userId]
  );
  return rows[0]?.payload ?? null;
}

export async function getPreferences(userId: string) {
  const { rows } = await pool().query(
    `select * from preferences where user_id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}
