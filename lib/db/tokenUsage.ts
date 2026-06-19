import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  _pool = new Pool({
    connectionString: url,
    // Heroku Postgres requires SSL; Node's default chain lacks Heroku's CA.
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
    max: 5,
  });
  return _pool;
}

export async function recordTokenUsage(row: {
  userId: string;
  sessionId: string;
  route: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  exact: boolean;
}): Promise<void> {
  await pool().query(
    `insert into token_usage
       (user_id, session_id, route, model, input_tokens, output_tokens, exact)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.userId,
      row.sessionId,
      row.route,
      row.model,
      Math.max(0, Math.round(row.inputTokens)),
      Math.max(0, Math.round(row.outputTokens)),
      row.exact,
    ]
  );
}

export interface SessionUsageSummary {
  models: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }>;
  totals: { inputTokens: number; outputTokens: number; exact: boolean };
}

export async function summarizeSessionUsage(
  sessionId: string
): Promise<SessionUsageSummary> {
  const { rows } = await pool().query<{
    model: string;
    input_tokens: string;
    output_tokens: string;
    exact: boolean;
  }>(
    `select model,
            sum(input_tokens)::bigint  as input_tokens,
            sum(output_tokens)::bigint as output_tokens,
            bool_and(exact)            as exact
       from token_usage
      where session_id = $1
      group by model
      order by sum(input_tokens) + sum(output_tokens) desc`,
    [sessionId]
  );

  const models = rows.map((r) => ({
    model: r.model,
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    exact: r.exact,
  }));

  const totals = models.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      exact: acc.exact && m.exact,
    }),
    { inputTokens: 0, outputTokens: 0, exact: true }
  );

  return { models, totals };
}
