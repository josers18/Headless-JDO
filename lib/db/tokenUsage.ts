import { Pool } from "pg";
import { estimateCostUsd } from "@/lib/llm/modelPricing";

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
  /** MCP tool calls dispatched during the run (optional; defaults 0). */
  toolCalls?: number;
  /** Wall-clock duration of the run in milliseconds (optional; defaults 0). */
  durationMs?: number;
}): Promise<void> {
  await pool().query(
    `insert into token_usage
       (user_id, session_id, route, model, input_tokens, output_tokens, exact,
        tool_calls, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      row.userId,
      row.sessionId,
      row.route,
      row.model,
      Math.max(0, Math.round(row.inputTokens)),
      Math.max(0, Math.round(row.outputTokens)),
      row.exact,
      Math.max(0, Math.round(row.toolCalls ?? 0)),
      Math.max(0, Math.round(row.durationMs ?? 0)),
    ]
  );
}

export interface SessionUsageModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  exact: boolean;
  /** Estimated USD cost for this model's tokens (from lib/llm/modelPricing). */
  costUsd: number;
}

export interface SessionUsageLastTurn {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number;
}

export interface SessionUsageSummary {
  models: SessionUsageModel[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
    costUsd: number;
  };
  /** Number of agent runs recorded this session (one row per run). */
  turns: number;
  /** Total MCP tool calls across the session. */
  toolCalls: number;
  /** The most recent run, for the "last turn" readout. Null if no rows. */
  lastTurn: SessionUsageLastTurn | null;
}

export async function summarizeSessionUsage(
  sessionId: string
): Promise<SessionUsageSummary> {
  // Per-model aggregate + session-wide turn/tool-call counts in one query.
  const { rows } = await pool().query<{
    model: string;
    input_tokens: string;
    output_tokens: string;
    tool_calls: string;
    exact: boolean;
    turns: string;
  }>(
    `select model,
            sum(input_tokens)::bigint  as input_tokens,
            sum(output_tokens)::bigint as output_tokens,
            sum(tool_calls)::bigint     as tool_calls,
            bool_and(exact)             as exact,
            count(*)::bigint            as turns
       from token_usage
      where session_id = $1
      group by model
      order by sum(input_tokens) + sum(output_tokens) desc`,
    [sessionId]
  );

  const models: SessionUsageModel[] = rows.map((r) => {
    const inputTokens = Number(r.input_tokens);
    const outputTokens = Number(r.output_tokens);
    return {
      model: r.model,
      inputTokens,
      outputTokens,
      toolCalls: Number(r.tool_calls),
      exact: r.exact,
      costUsd: estimateCostUsd(r.model, inputTokens, outputTokens),
    };
  });

  const totals = models.reduce(
    (acc, m) => ({
      inputTokens: acc.inputTokens + m.inputTokens,
      outputTokens: acc.outputTokens + m.outputTokens,
      exact: acc.exact && m.exact,
      costUsd: acc.costUsd + m.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, exact: true, costUsd: 0 }
  );

  const turns = rows.reduce((n, r) => n + Number(r.turns), 0);
  const toolCalls = models.reduce((n, m) => n + m.toolCalls, 0);

  // Most-recent run for the "last turn" readout.
  const { rows: lastRows } = await pool().query<{
    model: string;
    input_tokens: number;
    output_tokens: number;
    tool_calls: number;
    duration_ms: number;
  }>(
    `select model, input_tokens, output_tokens, tool_calls, duration_ms
       from token_usage
      where session_id = $1
      order by created_at desc
      limit 1`,
    [sessionId]
  );
  const last = lastRows[0];
  const lastTurn: SessionUsageLastTurn | null = last
    ? {
        model: last.model,
        inputTokens: Number(last.input_tokens),
        outputTokens: Number(last.output_tokens),
        toolCalls: Number(last.tool_calls),
        durationMs: Number(last.duration_ms),
      }
    : null;

  return { models, totals, turns, toolCalls, lastTurn };
}
