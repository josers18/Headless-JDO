# Session Token-Spend Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsed-by-default, expandable right-rail section showing token spend (input/output per model, with per-model subtotals and a grand total) for the current login session, persisted in Postgres so it survives reloads.

**Architecture:** Capture token usage at both OpenAI-compatible agent loops (`lib/llm/heroku.ts` and `lib/inference/heroku.ts`) via `stream_options.include_usage`, with a char/4 estimate fallback. Persist one `token_usage` row per agent run keyed by a new `hz_sid` session cookie. A `GET /api/usage` read endpoint sums the session's rows grouped by model. A React context provider feeds the panel; it refreshes from the DB on mount/focus/after-run and also accepts a live `usage_meta` SSE event (main stack) for instant Ask-Bar feedback.

**Tech Stack:** Next.js 15 App Router, React 18, TypeScript strict, `pg`, `openai` SDK (OpenAI-compatible), Tailwind, lucide-react. SSE via existing `lib/sse/stream.ts`.

## Global Constraints

- TypeScript strict; `noUncheckedIndexedAccess: true`. No `any` without a `// why:` comment.
- No new dependencies (use `pg`, `openai`, `lucide-react`, Tailwind — all already present).
- No `console.log` in committed code — use `lib/log.ts` (`log.info`/`log.warn` with correlation/keys).
- Tailwind only; pull colors/spacing from `components/brand/tokens.ts` patterns; match `AgentLog.tsx` chrome (`text-[10px] uppercase tracking-[0.2em] text-text-muted`, `rounded-xl border border-border-soft bg-surface`).
- A DB failure must NEVER break an agent run — all `token_usage` writes are fire-and-forget with `.catch()` logging.
- Agent routes stay SSE (streaming-first). `GET /api/usage` is a plain JSON read (not an agent call) — allowed.
- No test framework in this repo. "Tests" = `npm run typecheck`, targeted `tsx` scripts, and `npm run smoke:api` against a live dev server. Follow that pattern; do NOT add vitest/jest.
- Schema changes go in `lib/db/schema.sql` only, with `create ... if not exists` (idempotent — applied by `scripts/apply-schema.cjs` at release).
- Commit after each task.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `lib/llm/tokenUsageCapture.ts` | **new** — shared `estimateTokens` + `foldUsageChunk` + `RunUsage` type, used by both inference stacks (avoid drift) |
| `lib/db/schema.sql` | add `token_usage` table + index |
| `lib/db/tokenUsage.ts` | **new** — `recordTokenUsage`, `summarizeSessionUsage`, `SessionUsageSummary` |
| `lib/salesforce/token.ts` | write `hz_sid` cookie alongside `hz_sf`; add `getSessionId()` |
| `lib/llm/heroku.ts` | `stream_options.include_usage`; accumulate usage; `usage` on `AgentRunResult`; `usage_meta` on `AgentEvent` |
| `lib/llm/provider.ts` | stamp model; fire-and-forget DB write; emit `usage_meta`; `userId`/`sessionId`/`route` on `RunAgentInput`; `usage` on `RunAgentOutput` |
| `lib/inference/heroku.ts` | `stream_options.include_usage`; `usage` event on `HerokuInferenceEvent` |
| `lib/inference/askDataAgent.ts`, `lib/inference/analyzeAgent.ts` | consume `usage` event; expose run usage to their routes |
| `lib/sse/stream.ts` | `usage_meta` `SseEvent` variant + `sendUsageMeta` |
| `app/api/{ask,brief,priority,pulse,drafts,arc,prep,insights,pulse-strip}/route.ts`, `app/api/client/[id]/route.ts` | pass `userId`/`sessionId`/`route`; forward `usage_meta` |
| `app/api/ask-data/route.ts`, `app/api/analyze-ask/route.ts` | record usage row (no live event — separate SSE protocol) |
| `app/api/usage/route.ts` | **new** — `GET` session summary JSON |
| `lib/client/useAgentStream.ts` | parse `usage_meta`; `onUsage` opt callback |
| `components/horizon/SessionUsageProvider.tsx` | **new** — context + `useSessionUsage` hook |
| `components/horizon/TokenSpendPanel.tsx` | **new** — the right-rail panel |
| `app/(banker)/page.tsx` | mount provider + panel (right rail aside + inline) |

---

## Task 1: Shared token-usage capture helper

**Files:**
- Create: `lib/llm/tokenUsageCapture.ts`
- Test: `scripts/verify-token-capture.ts` (new tsx script)

**Interfaces:**
- Produces:
  - `interface RunUsage { inputTokens: number; outputTokens: number; exact: boolean }`
  - `function estimateTokens(text: string): number`
  - `function foldUsageChunk(acc: { inputTokens: number; outputTokens: number; exact: boolean }, usage: { prompt_tokens?: number | null; completion_tokens?: number | null } | null | undefined): void` — mutates `acc` in place; sets `exact = true` when a real usage chunk is folded.

- [ ] **Step 1: Write the verification script (the failing test)**

Create `scripts/verify-token-capture.ts`:

```ts
/**
 * scripts/verify-token-capture.ts — unit checks for the token capture
 * helper. Run: npx tsx scripts/verify-token-capture.ts
 */
export {};

import {
  estimateTokens,
  foldUsageChunk,
} from "../lib/llm/tokenUsageCapture";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    failures++;
  } else {
    console.log(`ok: ${name}`);
  }
}

// estimateTokens ~ chars/4, rounded up, never negative.
check("estimate empty is 0", estimateTokens("") === 0);
check("estimate 4 chars is 1", estimateTokens("abcd") === 1);
check("estimate 5 chars rounds up to 2", estimateTokens("abcde") === 2);

// foldUsageChunk: real usage marks exact and accumulates.
const acc = { inputTokens: 0, outputTokens: 0, exact: false };
foldUsageChunk(acc, { prompt_tokens: 10, completion_tokens: 5 });
check("fold accumulates input", acc.inputTokens === 10);
check("fold accumulates output", acc.outputTokens === 5);
check("fold marks exact", acc.exact === true);

// foldUsageChunk: null/undefined usage is a no-op, does not flip exact.
const acc2 = { inputTokens: 3, outputTokens: 2, exact: false };
foldUsageChunk(acc2, null);
foldUsageChunk(acc2, undefined);
check("fold null is no-op (input)", acc2.inputTokens === 3);
check("fold null keeps exact false", acc2.exact === false);

// foldUsageChunk: missing fields default to 0.
const acc3 = { inputTokens: 0, outputTokens: 0, exact: false };
foldUsageChunk(acc3, { prompt_tokens: 7 });
check("fold partial: input set", acc3.inputTokens === 7);
check("fold partial: output defaults 0", acc3.outputTokens === 0);
check("fold partial: still exact", acc3.exact === true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall token-capture checks passed");
```

- [ ] **Step 2: Run it to confirm it fails (module missing)**

Run: `npx tsx scripts/verify-token-capture.ts`
Expected: FAIL — `Cannot find module '../lib/llm/tokenUsageCapture'`.

- [ ] **Step 3: Implement the helper**

Create `lib/llm/tokenUsageCapture.ts`:

```ts
/**
 * lib/llm/tokenUsageCapture.ts — shared token-accounting helpers used by
 * BOTH OpenAI-compatible agent loops (lib/llm/heroku.ts and
 * lib/inference/heroku.ts). Centralized so the two stacks can't drift.
 *
 * Exact counts come from the upstream `usage` chunk (requires
 * stream_options.include_usage AND upstream support). When that chunk
 * never arrives, callers fall back to estimateTokens() and mark the
 * run `exact: false` so the UI can show an "≈ approximate" marker.
 */

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  /** false when any portion of the run was estimated rather than reported. */
  exact: boolean;
}

/** Crude chars-per-token heuristic (~4 chars/token). Rounds up; never negative. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Fold an upstream usage payload into a running accumulator, in place.
 * A non-null payload marks the run `exact`. Missing fields count as 0.
 */
export function foldUsageChunk(
  acc: { inputTokens: number; outputTokens: number; exact: boolean },
  usage:
    | { prompt_tokens?: number | null; completion_tokens?: number | null }
    | null
    | undefined
): void {
  if (!usage) return;
  acc.inputTokens += usage.prompt_tokens ?? 0;
  acc.outputTokens += usage.completion_tokens ?? 0;
  acc.exact = true;
}
```

- [ ] **Step 4: Run it to confirm it passes**

Run: `npx tsx scripts/verify-token-capture.ts`
Expected: PASS — `all token-capture checks passed`.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/llm/tokenUsageCapture.ts scripts/verify-token-capture.ts
git commit -m "feat(usage): shared token-capture helper (estimate + fold)"
```

---

## Task 2: token_usage table + DB module

**Files:**
- Modify: `lib/db/schema.sql` (append table)
- Create: `lib/db/tokenUsage.ts`
- Test: `scripts/verify-token-usage-db.ts` (new tsx script, requires `DATABASE_URL`)

**Interfaces:**
- Consumes: `RunUsage` is NOT used here (DB stores raw ints).
- Produces:
  - `function recordTokenUsage(row: { userId: string; sessionId: string; route: string; model: string; inputTokens: number; outputTokens: number; exact: boolean }): Promise<void>`
  - `interface SessionUsageSummary { models: Array<{ model: string; inputTokens: number; outputTokens: number; exact: boolean }>; totals: { inputTokens: number; outputTokens: number; exact: boolean } }`
  - `function summarizeSessionUsage(sessionId: string): Promise<SessionUsageSummary>`

- [ ] **Step 1: Add the table to schema.sql**

Append to `lib/db/schema.sql`:

```sql
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
```

- [ ] **Step 2: Write the verification script (the failing test)**

Create `scripts/verify-token-usage-db.ts`:

```ts
/**
 * scripts/verify-token-usage-db.ts — applies schema, writes sample rows,
 * verifies summarizeSessionUsage grouping + exact logic, then cleans up.
 * Run: npx tsx --env-file=.env scripts/verify-token-usage-db.ts
 * Requires DATABASE_URL (a local/dev Postgres).
 */
export {};

import { Client } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import {
  recordTokenUsage,
  summarizeSessionUsage,
} from "../lib/db/tokenUsage";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set");
    process.exit(2);
  }
  // Apply schema (idempotent).
  const sql = readFileSync(join(__dirname, "..", "lib", "db", "schema.sql"), "utf8");
  const c = new Client({
    connectionString: url,
    ssl: url.includes("localhost") ? false : { rejectUnauthorized: false },
  });
  await c.connect();
  await c.query(sql);

  const sid = `verify-${Date.now()}`;
  let failures = 0;
  const check = (n: string, ok: boolean) => {
    console.log(`${ok ? "ok" : "FAIL"}: ${n}`);
    if (!ok) failures++;
  };

  try {
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "ask", model: "claude-4-5-sonnet", inputTokens: 100, outputTokens: 40, exact: true });
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "brief", model: "claude-4-5-sonnet", inputTokens: 50, outputTokens: 10, exact: false });
    await recordTokenUsage({ userId: "u1", sessionId: sid, route: "ask-data", model: "kimi-k2-thinking", inputTokens: 200, outputTokens: 80, exact: true });

    const s = await summarizeSessionUsage(sid);
    const claude = s.models.find((m) => m.model === "claude-4-5-sonnet");
    const kimi = s.models.find((m) => m.model === "kimi-k2-thinking");

    check("two models grouped", s.models.length === 2);
    check("claude input summed", claude?.inputTokens === 150);
    check("claude output summed", claude?.outputTokens === 50);
    check("claude exact=false (one estimated run)", claude?.exact === false);
    check("kimi exact=true", kimi?.exact === true);
    check("grand total input", s.totals.inputTokens === 350);
    check("grand total output", s.totals.outputTokens === 130);
    check("grand total exact=false", s.totals.exact === false);

    const empty = await summarizeSessionUsage(`nonexistent-${Date.now()}`);
    check("empty session: no models", empty.models.length === 0);
    check("empty session: totals zero", empty.totals.inputTokens === 0 && empty.totals.outputTokens === 0);
    check("empty session: exact=true default", empty.totals.exact === true);
  } finally {
    await c.query("delete from token_usage where session_id = $1", [sid]);
    await c.end();
  }

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall token-usage-db checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Run it to confirm it fails (module missing)**

Run: `npx tsx --env-file=.env scripts/verify-token-usage-db.ts`
Expected: FAIL — `Cannot find module '../lib/db/tokenUsage'`.

- [ ] **Step 4: Implement the DB module**

Create `lib/db/tokenUsage.ts`:

```ts
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
```

- [ ] **Step 5: Run it to confirm it passes**

Run: `npx tsx --env-file=.env scripts/verify-token-usage-db.ts`
Expected: PASS — `all token-usage-db checks passed`.

> If no local Postgres is available, note that and defer this script to the next environment with `DATABASE_URL`; still run typecheck.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/db/schema.sql lib/db/tokenUsage.ts scripts/verify-token-usage-db.ts
git commit -m "feat(usage): token_usage table + record/summarize queries"
```

---

## Task 3: hz_sid session cookie + getSessionId()

**Files:**
- Modify: `lib/salesforce/token.ts`

**Interfaces:**
- Produces: `function getSessionId(): Promise<string>` — returns the `hz_sid` cookie value; if absent, returns `legacy:<user_id>` derived from `hz_sf`, or `legacy:unknown`.

- [ ] **Step 1: Add the sid cookie name + write logic**

In `lib/salesforce/token.ts`, near the top (after `const COOKIE_NAME = "hz_sf";`), add:

```ts
const SID_COOKIE_NAME = "hz_sid";
```

In `persistTokenFromOAuthResponse`, AFTER the existing `jar.set(COOKIE_NAME, ...)` call, add — only minting a new sid when one isn't already present, so a token refresh keeps the same session:

```ts
  // Session id for token-spend accounting. Mint once per login; a refresh
  // (previous != null with an existing hz_sid) keeps the same id so the
  // tally is continuous across the 8h token lifetime.
  if (!jar.get(SID_COOKIE_NAME)?.value) {
    const sid =
      (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID?.() ??
      `sid_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    jar.set(SID_COOKIE_NAME, sid, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }
```

- [ ] **Step 2: Add getSessionId() + clear on logout**

Add this exported function (near `getTokenCookie`):

```ts
/**
 * Stable id for the current login session, used to scope token-spend
 * accounting. Falls back to a per-user "legacy:" id for sessions that
 * predate the hz_sid cookie so their spend still accumulates.
 */
export async function getSessionId(): Promise<string> {
  const jar = await cookies();
  const sid = jar.get(SID_COOKIE_NAME)?.value;
  if (sid) return sid;
  const raw = jar.get(COOKIE_NAME)?.value;
  if (raw) {
    try {
      const t = JSON.parse(raw) as StoredToken;
      if (t.user_id) return `legacy:${t.user_id}`;
    } catch {
      /* fall through */
    }
  }
  return "legacy:unknown";
}
```

In `clearTokenCookie`, also delete the sid so re-login starts fresh:

```ts
export async function clearTokenCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  jar.delete(SID_COOKIE_NAME);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/salesforce/token.ts
git commit -m "feat(usage): hz_sid session cookie + getSessionId()"
```

---

## Task 4: Capture usage in the main agent loop (lib/llm/heroku.ts)

**Files:**
- Modify: `lib/llm/heroku.ts`

**Interfaces:**
- Consumes: `RunUsage`, `estimateTokens`, `foldUsageChunk` from `lib/llm/tokenUsageCapture.ts` (Task 1).
- Produces:
  - `AgentRunResult.usage: RunUsage` (model id stamped later in provider.ts — here it carries only counts + exact).
  - `AgentEvent` gains a `usage_meta` member: `type` union adds `"usage_meta"`, plus optional `usage?: { model: string; inputTokens: number; outputTokens: number; exact: boolean }`.

- [ ] **Step 1: Import the helper + extend types**

At the top imports of `lib/llm/heroku.ts`, add:

```ts
import {
  estimateTokens,
  foldUsageChunk,
  type RunUsage,
} from "@/lib/llm/tokenUsageCapture";
```

In the `AgentEvent` interface, add `"usage_meta"` to the `type` union and add the optional field:

```ts
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  };
```

In `AgentRunResult`, add:

```ts
  usage: RunUsage;
```

- [ ] **Step 2: Initialize the accumulator before the loop**

In `runAgent`, just before `for (iteration = 1; ...)`, add:

```ts
  // Per-run token accounting. Real counts come from the upstream usage
  // chunk (stream_options.include_usage); when absent we estimate.
  const usageAcc = { inputTokens: 0, outputTokens: 0, exact: false };
```

- [ ] **Step 3: Request usage on every streamed completion**

In the main loop's `client.chat.completions.create({...})` call, add `stream_options`:

```ts
      stream: true,
      stream_options: { include_usage: true },
```

Do the same on the finalize-pass `client.chat.completions.create({...})` near the end of `runAgent` (the one with `tool_choice: "none"`).

- [ ] **Step 4: Fold usage from each chunk + estimate fallback**

Inside the main `for await (const chunk of stream)` loop, after the existing `delta` handling (still inside the loop), add:

```ts
      // why: the usage chunk typically has an empty choices array, so it
      // arrives after content/tool deltas. include_usage gives exact
      // counts when the upstream supports it.
      foldUsageChunk(usageAcc, chunk.usage);
```

(`chunk.usage` is typed by the OpenAI SDK as optional; `foldUsageChunk` no-ops on undefined.)

In the finalize pass loop (`for await (const chunk of finalize)`), add the same line after the content handling:

```ts
      foldUsageChunk(usageAcc, chunk.usage);
```

- [ ] **Step 5: Estimate fallback + attach usage to BOTH return paths**

Add a small local helper inside `runAgent` (after `usageAcc` declaration is fine, or just before first return) — but to keep it DRY, compute at each return. Define near the top of `runAgent` after `usageAcc`:

```ts
  // Finalized usage for a return: if no exact chunk ever arrived, estimate
  // from the transcript (sum of message contents) + final prose.
  const finalizeUsage = (assistantText: string): RunUsage => {
    if (usageAcc.exact) {
      return { inputTokens: usageAcc.inputTokens, outputTokens: usageAcc.outputTokens, exact: true };
    }
    const inputChars = messages.reduce((n, m) => {
      const c = typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "");
      return n + c.length;
    }, 0);
    return {
      inputTokens: estimateTokens(String(inputChars ? inputChars : 0) && "".padEnd(inputChars, "x")),
      outputTokens: estimateTokens(assistantText),
      exact: false,
    };
  };
```

> Note: `estimateTokens` takes a string; to estimate from a char count, call `estimateTokens` with the actual concatenated text instead of padding. Replace the input estimate with a direct concatenation to avoid allocating a huge padded string:

Use this cleaner version instead:

```ts
  const finalizeUsage = (assistantText: string): RunUsage => {
    if (usageAcc.exact) {
      return {
        inputTokens: usageAcc.inputTokens,
        outputTokens: usageAcc.outputTokens,
        exact: true,
      };
    }
    const inputText = messages
      .map((m) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
      )
      .join("\n");
    return {
      inputTokens: estimateTokens(inputText),
      outputTokens: estimateTokens(assistantText),
      exact: false,
    };
  };
```

Then at the **early return** (the `if (calls.length === 0)` block), change the returned object to include:

```ts
      return {
        text: finalText,
        toolCalls: collectedCalls,
        iterations: iteration,
        transcript: messages.slice(1),
        usage: finalizeUsage(finalText),
      };
```

And at the **final return** (end of function, after the iteration cap), change:

```ts
  return {
    text: finalText || "(agent exceeded iteration cap without final answer)",
    toolCalls: collectedCalls,
    iterations: iteration - 1,
    transcript: messages.slice(1),
    usage: finalizeUsage(finalText || lastAssistantText),
  };
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (If the OpenAI SDK types don't expose `chunk.usage`, add `// why: include_usage emits a trailing usage chunk the SDK types as optional` and access via `(chunk as { usage?: ... }).usage` — but the installed `openai` version does type it; verify first.)

- [ ] **Step 7: Commit**

```bash
git add lib/llm/heroku.ts
git commit -m "feat(usage): capture token usage in main agent loop"
```

---

## Task 5: Stamp model, persist, and emit usage_meta (lib/llm/provider.ts)

**Files:**
- Modify: `lib/llm/provider.ts`

**Interfaces:**
- Consumes: `AgentRunResult.usage` (Task 4); `recordTokenUsage` (Task 2); `AgentEvent` `usage_meta` shape (Task 4).
- Produces:
  - `RunAgentInput` gains optional `userId?: string`, `sessionId?: string`, `route?: string`.
  - `RunAgentOutput` gains `usage: { model: string; inputTokens: number; outputTokens: number; exact: boolean }`.

- [ ] **Step 1: Extend input/output types + imports**

In `lib/llm/provider.ts`, add the import:

```ts
import { recordTokenUsage } from "@/lib/db/tokenUsage";
```

Add to `RunAgentInput`:

```ts
  /** Banker user id for token-spend attribution. */
  userId?: string;
  /** Login-session id (hz_sid) for token-spend scoping. */
  sessionId?: string;
  /** Route label for token-spend rows (e.g. "ask", "brief"). */
  route?: string;
```

Add to `RunAgentOutput`:

```ts
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  };
```

- [ ] **Step 2: Stamp model in withInferenceBackend**

Replace `withInferenceBackend` so it stamps the resolved model id onto usage:

```ts
function withInferenceBackend(
  result: AgentRunResult,
  inferenceBackend: InferenceBackend
): RunAgentOutput {
  return {
    ...result,
    inferenceBackend,
    usage: {
      model: modelIdFor(inferenceBackend),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      exact: result.usage.exact,
    },
  };
}
```

(`modelIdFor` is already imported in this file.)

- [ ] **Step 3: Persist + emit after each successful run**

Wrap the run-and-return so usage is recorded and emitted. Replace the body of the inner `try` (the `return withInferenceBackend(await runOnce("heroku"), "heroku")` area) with a small post-run step. Add a helper inside `runAgentWithMcp` after `const runOnce = ...`:

```ts
  const afterRun = (out: RunAgentOutput): RunAgentOutput => {
    // Live event for the main SSE stack (Ask Bar + sections) — instant
    // panel feedback before the DB refetch lands.
    input.onEvent?.({ type: "usage_meta", usage: out.usage });
    // Fire-and-forget persistence. A DB failure must never break a run.
    void recordTokenUsage({
      userId: input.userId ?? "unknown",
      sessionId: input.sessionId ?? "unknown",
      route: input.route ?? input.routeHint ?? "unknown",
      model: out.usage.model,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
      exact: out.usage.exact,
    }).catch((e) =>
      log.warn("token_usage.write_failed", {
        route: input.route ?? input.routeHint ?? "unknown",
        error: e instanceof Error ? e.message : String(e),
      })
    );
    return out;
  };
```

Then wrap each return in the `try`:

```ts
  try {
    if (requested === "onyx") {
      log.info("agent.inference.kimi_only", {
        routeHint: input.routeHint ?? "",
        model: modelIdFor("onyx"),
      });
      return afterRun(withInferenceBackend(await runOnce("onyx"), "onyx"));
    }

    try {
      return afterRun(withInferenceBackend(await runOnce("heroku"), "heroku"));
    } catch (primaryErr) {
      if (!isOnyxInferenceConfigured()) throw primaryErr;
      const reason =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      log.warn("agent.inference.heroku.fallback_kimi", {
        routeHint: input.routeHint ?? "",
        error: reason.slice(0, 500),
      });
      return afterRun(withInferenceBackend(await runOnce("onyx"), "onyx"));
    }
  } finally {
    await registry.close();
  }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/llm/provider.ts
git commit -m "feat(usage): persist + emit token usage from provider"
```

---

## Task 6: usage_meta SSE event + helper (lib/sse/stream.ts)

**Files:**
- Modify: `lib/sse/stream.ts`

**Interfaces:**
- Produces:
  - `SseEvent` gains `{ type: "usage_meta"; usage: { model: string; inputTokens: number; outputTokens: number; exact: boolean } }`.
  - `function sendUsageMeta(send: (e: SseEvent) => void, usage: { model: string; inputTokens: number; outputTokens: number; exact: boolean }): void`.

- [ ] **Step 1: Add the event variant**

In `lib/sse/stream.ts`, add to the `SseEvent` union:

```ts
  | {
      type: "usage_meta";
      usage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        exact: boolean;
      };
    }
```

- [ ] **Step 2: Add the helper (next to sendInferenceMeta)**

```ts
/** Emit this run's token usage so the panel can bump live. */
export function sendUsageMeta(
  send: (e: SseEvent) => void,
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }
): void {
  send({ type: "usage_meta", usage });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/sse/stream.ts
git commit -m "feat(usage): usage_meta SSE event + sendUsageMeta helper"
```

---

## Task 7: Wire main-stack routes (pass identity, forward usage_meta)

**Files:**
- Modify: `app/api/ask/route.ts`, `app/api/brief/route.ts`, `app/api/priority/route.ts`, `app/api/pulse/route.ts`, `app/api/drafts/route.ts`, `app/api/arc/route.ts`, `app/api/prep/route.ts`, `app/api/insights/route.ts`, `app/api/pulse-strip/route.ts`, `app/api/client/[id]/route.ts`

**Interfaces:**
- Consumes: `getSessionId` (Task 3), `RunAgentInput.{userId,sessionId,route}` (Task 5), `usage_meta` `AgentEvent` (Task 4).

> Each route differs slightly; the PATTERN is identical. Below is the exact edit for `app/api/ask/route.ts`; apply the same shape to each other route, using that route's existing `bankerUserId`/userId variable and a literal route name matching the folder (`"brief"`, `"priority"`, `"pulse"`, `"drafts"`, `"arc"`, `"prep"`, `"insights"`, `"pulse-strip"`, `"client"`).

- [ ] **Step 1: Import getSessionId in each route**

Add to imports (ask/route.ts already imports from `@/lib/salesforce/token`):

```ts
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
```

(For routes that import only `ensureFreshToken`, extend the same import. For routes importing nothing from token.ts, add a fresh import line.)

- [ ] **Step 2: Resolve sessionId before runAgentWithMcp**

In `app/api/ask/route.ts`, after `const token = await ensureFreshToken();` block, add:

```ts
  const sessionId = await getSessionId();
```

- [ ] **Step 3: Pass identity into runAgentWithMcp + forward usage_meta**

In the `runAgentWithMcp({ ... })` call, add the three fields:

```ts
      salesforceToken: token.access_token,
      userId: bankerUserId,
      sessionId,
      route: "ask",
```

In the `onEvent` handler, add a `usage_meta` branch (alongside the existing `text_delta`/`tool_use`/`tool_result` branches):

```ts
        } else if (e.type === "usage_meta" && e.usage) {
          send({ type: "usage_meta", usage: e.usage });
        }
```

- [ ] **Step 4: Repeat for the other nine routes**

For each route, mirror Steps 1–3: import `getSessionId`, resolve `const sessionId = await getSessionId();`, pass `userId`/`sessionId`/`route: "<name>"`, and add the `usage_meta` forward branch inside that route's `onEvent`. Use the route's existing user-id variable (most use `bankerUserId`; confirm per file).

> For routes using `makeCacheableSseStream` (e.g. brief/priority/pulse/drafts that cache per-day): the `usage_meta` event will be captured into the cached sequence. That is acceptable — replays will re-emit the original run's usage, which is correct for "what this session spent." No special handling needed.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/ask/route.ts app/api/brief/route.ts app/api/priority/route.ts app/api/pulse/route.ts app/api/drafts/route.ts app/api/arc/route.ts app/api/prep/route.ts app/api/insights/route.ts app/api/pulse-strip/route.ts "app/api/client/[id]/route.ts"
git commit -m "feat(usage): wire main-stack routes to record + forward usage"
```

---

## Task 8: Capture usage in the second stack (ask-data / analyze)

**Files:**
- Modify: `lib/inference/heroku.ts`, `lib/inference/askDataAgent.ts`, `lib/inference/analyzeAgent.ts`, `app/api/ask-data/route.ts`, `app/api/analyze-ask/route.ts`

**Interfaces:**
- Consumes: `estimateTokens`, `foldUsageChunk` (Task 1); `recordTokenUsage` (Task 2); `getSessionId` (Task 3).
- Produces:
  - `HerokuInferenceEvent` gains `{ type: "usage"; inputTokens: number; outputTokens: number; exact: boolean }`.
  - `AskDataAgentEvent` gains `{ type: "usage"; inputTokens: number; outputTokens: number; exact: boolean; model: string }`.

- [ ] **Step 1: Extend HerokuInferenceEvent + capture in streamHeroku**

In `lib/inference/heroku.ts`, add import:

```ts
import { estimateTokens, foldUsageChunk } from "@/lib/llm/tokenUsageCapture";
```

Add to the `HerokuInferenceEvent` union:

```ts
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
    }
```

In `streamHeroku`, add `stream_options: { include_usage: true }` to the `client.chat.completions.create({...})` options object (alongside `stream: true`). Before the `for await` loop, add:

```ts
  const usageAcc = { inputTokens: 0, outputTokens: 0, exact: false };
  let assistantText = "";
```

Inside the loop, where tokens are yielded, also accumulate text, and fold usage each chunk. After the existing `if (delta && typeof delta.content === "string" ...)` block, add inside it `assistantText += delta.content;` (right before/after the `yield`), and after the `if (choice.finish_reason)` block add:

```ts
    foldUsageChunk(usageAcc, chunk.usage);
```

Just before the final `yield { type: "done", stopReason };`, add:

```ts
  yield usageAcc.exact
    ? {
        type: "usage",
        inputTokens: usageAcc.inputTokens,
        outputTokens: usageAcc.outputTokens,
        exact: true,
      }
    : {
        type: "usage",
        inputTokens: estimateTokens(
          messages
            .map((m) =>
              typeof m.content === "string"
                ? m.content
                : JSON.stringify(m.content ?? "")
            )
            .join("\n")
        ),
        outputTokens: estimateTokens(assistantText),
        exact: false,
      };
```

- [ ] **Step 2: Forward usage through askDataAgent**

In `lib/inference/askDataAgent.ts`, add to the `AskDataAgentEvent` union:

```ts
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
      model: string;
    }
```

`streamHeroku` returns `modelId` only on the non-streaming result, not the stream. The model for ask-data is the reasoning tier — resolve it from env the same way `resolveTierConfig` does. Import at top:

```ts
import { optionalEnv } from "@/lib/utils";
```

Inside `runAskDataAgent`, where it consumes `for await (const ev of streamHeroku({...}))`, add a branch to re-yield usage stamped with the model id:

```ts
        } else if (ev.type === "usage") {
          yield {
            type: "usage",
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            exact: ev.exact,
            model: optionalEnv("HEROKU_INFERENCE_ONYX_MODEL_ID") || "kimi-k2-thinking",
          };
        }
```

> Place this branch alongside the existing `ev.type === "token"` / `"tool_call"` handling in the same `for await` loop. There may be more than one `streamHeroku` loop in the file (per iteration) — add the branch to each loop that forwards events, OR accumulate at the function level. Simplest correct approach: maintain a function-level `let usageTotal = { inputTokens: 0, outputTokens: 0, exact: true }`, and in every loop's usage branch do `usageTotal.inputTokens += ev.inputTokens; usageTotal.outputTokens += ev.outputTokens; usageTotal.exact = usageTotal.exact && ev.exact;` — then yield ONE `usage` event right before the final `turn_complete` yield. Use this accumulating approach.

Concretely: declare near the top of `runAskDataAgent`:

```ts
  const usageTotal = { inputTokens: 0, outputTokens: 0, exact: true };
```

In each `for await (const ev of streamHeroku(...))`, add:

```ts
        } else if (ev.type === "usage") {
          usageTotal.inputTokens += ev.inputTokens;
          usageTotal.outputTokens += ev.outputTokens;
          usageTotal.exact = usageTotal.exact && ev.exact;
        }
```

Immediately before the final `yield { type: "turn_complete", ... }`, add:

```ts
  yield {
    type: "usage",
    inputTokens: usageTotal.inputTokens,
    outputTokens: usageTotal.outputTokens,
    exact: usageTotal.exact,
    model: optionalEnv("HEROKU_INFERENCE_ONYX_MODEL_ID") || "kimi-k2-thinking",
  };
```

- [ ] **Step 3: Record usage in ask-data route**

In `app/api/ask-data/route.ts`, add imports:

```ts
import { recordTokenUsage } from "@/lib/db/tokenUsage";
import { getSessionId } from "@/lib/salesforce/token";
```

After the existing `const userId = await currentBankerUserId();`, add:

```ts
  const sessionId = await getSessionId();
```

In the `for await (const ev of runAskDataAgent({...}))` loop, add a `usage` branch that fires the DB write (no SSE forward — the ask-data client uses a different protocol and reads via /api/usage on focus):

```ts
        } else if (ev.type === "usage") {
          void recordTokenUsage({
            userId,
            sessionId,
            route: "ask-data",
            model: ev.model,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            exact: ev.exact,
          }).catch(() => {});
        }
```

- [ ] **Step 4: Do the same for analyzeAgent + analyze-ask route**

In `lib/inference/analyzeAgent.ts`, mirror Step 2: add a `usage` member to its event union (same shape with `model`), accumulate from `streamHeroku`'s `usage` event, and yield one `usage` event before its terminal event. In `app/api/analyze-ask/route.ts`, mirror Step 3: import `recordTokenUsage` + `getSessionId`, resolve `sessionId`, and write a row with `route: "analyze"` on the `usage` event.

> Read `lib/inference/analyzeAgent.ts` first to find its event-union name and its terminal event (it may differ from `turn_complete`). Apply the same accumulate-then-yield pattern.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/inference/heroku.ts lib/inference/askDataAgent.ts lib/inference/analyzeAgent.ts app/api/ask-data/route.ts app/api/analyze-ask/route.ts
git commit -m "feat(usage): capture token usage in ask-data + analyze stack"
```

---

## Task 9: GET /api/usage read endpoint

**Files:**
- Create: `app/api/usage/route.ts`

**Interfaces:**
- Consumes: `getSessionId` (Task 3), `summarizeSessionUsage` + `SessionUsageSummary` (Task 2), `ensureFreshToken` (existing).
- Produces: `GET /api/usage` → `SessionUsageSummary` JSON, or 401.

- [ ] **Step 1: Write the route**

Create `app/api/usage/route.ts`:

```ts
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { summarizeSessionUsage } from "@/lib/db/tokenUsage";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const sessionId = await getSessionId();
  try {
    const summary = await summarizeSessionUsage(sessionId);
    return Response.json(summary);
  } catch (e) {
    log.warn("usage.read_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Degrade to an empty summary rather than a 500 — the panel just
    // shows nothing instead of breaking the page.
    return Response.json({
      models: [],
      totals: { inputTokens: 0, outputTokens: 0, exact: true },
    });
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke (live dev server)**

With `npm run dev` running and a valid `hz_sf` cookie in the browser, open `http://localhost:3000/api/usage`.
Expected: JSON `{ "models": [...], "totals": {...} }` (likely populated after the home page has loaded its sections).

- [ ] **Step 4: Commit**

```bash
git add app/api/usage/route.ts
git commit -m "feat(usage): GET /api/usage session summary endpoint"
```

---

## Task 10: useAgentStream parses usage_meta

**Files:**
- Modify: `lib/client/useAgentStream.ts`

**Interfaces:**
- Consumes: `usage_meta` SSE frame (Task 6).
- Produces: `start(url, body, opts)` opts gains `onUsage?: (u: { model: string; inputTokens: number; outputTokens: number; exact: boolean }) => void`.

- [ ] **Step 1: Extend IncomingEvent union**

In `lib/client/useAgentStream.ts`, add to `IncomingEvent`:

```ts
  | {
      type: "usage_meta";
      usage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        exact: boolean;
      };
    }
```

- [ ] **Step 2: Add onUsage to start opts**

In the `start` signature opts (both the `AgentStreamState["start"]` type and the `useCallback` impl), add:

```ts
      onUsage?: (u: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        exact: boolean;
      }) => void;
```

- [ ] **Step 3: Handle the event in applyEvent**

In `applyEvent`, add a branch:

```ts
        } else if (msg.type === "usage_meta") {
          opts?.onUsage?.(msg.usage);
```

> `applyEvent` is defined inside `start`, so `opts` is in scope. Confirm placement matches the existing `inference_meta` branch.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/client/useAgentStream.ts
git commit -m "feat(usage): useAgentStream surfaces usage_meta via onUsage"
```

---

## Task 11: SessionUsageProvider context

**Files:**
- Create: `components/horizon/SessionUsageProvider.tsx`

**Interfaces:**
- Consumes: `SessionUsageSummary` shape (Task 2) — redeclared client-side as a local type (no server import in a client component).
- Produces:
  - `SessionUsageProvider` React component.
  - `useSessionUsage(): { data: SessionUsageSummary | null; loading: boolean; refresh: () => void; bumpLive: (u: { model: string; inputTokens: number; outputTokens: number; exact: boolean }) => void }`.

- [ ] **Step 1: Write the provider**

Create `components/horizon/SessionUsageProvider.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface SessionUsageSummary {
  models: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }>;
  totals: { inputTokens: number; outputTokens: number; exact: boolean };
}

interface SessionUsageCtx {
  data: SessionUsageSummary | null;
  loading: boolean;
  refresh: () => void;
  bumpLive: (u: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }) => void;
}

const Ctx = createContext<SessionUsageCtx | null>(null);

export function SessionUsageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<SessionUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    fetch("/api/usage", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SessionUsageSummary | null) => {
        if (j && Array.isArray(j.models)) setData(j);
      })
      .catch(() => {
        /* keep last good data */
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  const bumpLive = useCallback(
    (u: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
    }) => {
      setData((prev) => {
        const base: SessionUsageSummary = prev ?? {
          models: [],
          totals: { inputTokens: 0, outputTokens: 0, exact: true },
        };
        const models = base.models.map((m) => ({ ...m }));
        const existing = models.find((m) => m.model === u.model);
        if (existing) {
          existing.inputTokens += u.inputTokens;
          existing.outputTokens += u.outputTokens;
          existing.exact = existing.exact && u.exact;
        } else {
          models.push({
            model: u.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            exact: u.exact,
          });
        }
        return {
          models,
          totals: {
            inputTokens: base.totals.inputTokens + u.inputTokens,
            outputTokens: base.totals.outputTokens + u.outputTokens,
            exact: base.totals.exact && u.exact,
          },
        };
      });
    },
    []
  );

  // Initial load + refresh when the tab regains focus (background section
  // runs may have written rows while the user was away).
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ data, loading, refresh, bumpLive }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSessionUsage(): SessionUsageCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe no-op fallback so the panel can be rendered outside the
    // provider during incremental wiring without throwing.
    return {
      data: null,
      loading: false,
      refresh: () => {},
      bumpLive: () => {},
    };
  }
  return ctx;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/horizon/SessionUsageProvider.tsx
git commit -m "feat(usage): SessionUsageProvider context (refresh + bumpLive)"
```

---

## Task 12: TokenSpendPanel component

**Files:**
- Create: `components/horizon/TokenSpendPanel.tsx`

**Interfaces:**
- Consumes: `useSessionUsage` (Task 11).

- [ ] **Step 1: Write the panel (mirrors AgentLog chrome)**

Create `components/horizon/TokenSpendPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Coins, ChevronDown, ChevronUp } from "lucide-react";
import { useSessionUsage } from "./SessionUsageProvider";

/** Humanize a token count: 950 → "950", 48230 → "48.2k", 1_200_000 → "1.2M". */
function fmt(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** Strip a provider prefix for display: "claude-4-5-sonnet" stays; long ids trim. */
function modelLabel(model: string): string {
  return model.replace(/^.*\//, "");
}

export function TokenSpendPanel() {
  const { data } = useSessionUsage();
  const [open, setOpen] = useState(false);

  if (!data || data.models.length === 0) return null;

  const grand = data.totals.inputTokens + data.totals.outputTokens;
  const approx = !data.totals.exact;

  return (
    <section
      aria-labelledby="token-spend-h"
      className="mt-4 rounded-xl border border-border-soft bg-surface px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span
          id="token-spend-h"
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-text-muted"
        >
          <Coins size={12} className="opacity-70" />
          Tokens
          <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] text-text-muted/80">
            {approx ? "≈" : ""}
            {fmt(grand)}
          </span>
        </span>
        {open ? (
          <ChevronUp size={12} className="text-text-muted" />
        ) : (
          <ChevronDown size={12} className="text-text-muted" />
        )}
      </button>

      {open && (
        <div className="mt-3">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-text-muted/70">
                <th className="pb-1 text-left font-medium uppercase tracking-[0.12em]">
                  Model
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  In
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  Out
                </th>
                <th className="pb-1 text-right font-medium uppercase tracking-[0.12em]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft/30">
              {data.models.map((m) => (
                <tr key={m.model} className="text-text">
                  <td className="py-1.5 pr-2">
                    {modelLabel(m.model)}
                    {!m.exact && (
                      <span
                        title="Includes estimated counts"
                        className="ml-1 text-text-muted/60"
                      >
                        ≈
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.inputTokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.outputTokens)}
                  </td>
                  <td className="py-1.5 text-right font-mono tabular-nums">
                    {fmt(m.inputTokens + m.outputTokens)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-soft text-text">
                <td className="pt-2 text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  Session total
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {fmt(data.totals.inputTokens)}
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {fmt(data.totals.outputTokens)}
                </td>
                <td className="pt-2 text-right font-mono tabular-nums">
                  {approx ? "≈" : ""}
                  {fmt(grand)}
                </td>
              </tr>
            </tfoot>
          </table>
          {approx && (
            <p className="mt-2 text-[10px] text-text-muted/70">
              ≈ includes estimated counts (provider did not report exact
              usage for some runs).
            </p>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/horizon/TokenSpendPanel.tsx
git commit -m "feat(usage): TokenSpendPanel right-rail component"
```

---

## Task 13: Mount provider + panel on the home page; wire Ask Bar bumpLive

**Files:**
- Modify: `app/(banker)/page.tsx`
- Modify: `components/horizon/AskBar.tsx`

**Interfaces:**
- Consumes: `SessionUsageProvider` (Task 11), `TokenSpendPanel` (Task 12), `useSessionUsage` (Task 11), `useAgentStream` `onUsage` (Task 10).

- [ ] **Step 1: Import provider + panel in page.tsx**

In `app/(banker)/page.tsx`, add imports:

```ts
import { SessionUsageProvider } from "@/components/horizon/SessionUsageProvider";
import { TokenSpendPanel } from "@/components/horizon/TokenSpendPanel";
```

- [ ] **Step 2: Wrap the signed-in tree with the provider**

Wrap the existing `<InsightsBatchProvider>` (or the nearest signed-in provider stack) so the panel and Ask Bar share one context. Change:

```tsx
            <SectionContentPresenceProvider>
            <InsightsBatchProvider>
```

to:

```tsx
            <SectionContentPresenceProvider>
            <SessionUsageProvider>
            <InsightsBatchProvider>
```

and add the matching close tag after the existing `</InsightsBatchProvider>`:

```tsx
            </InsightsBatchProvider>
            </SessionUsageProvider>
            </SectionContentPresenceProvider>
```

> `AskBar` is rendered OUTSIDE `HorizonSignedIn` (it's a sibling at the bottom). To share context with it, the provider must wrap BOTH. Move `<SessionUsageProvider>` to wrap the whole `signedIn && (<> ... <AskBar /> </>)` block instead of only the inner tree. Concretely: wrap from just inside `{signedIn && (` with `<SessionUsageProvider>` ... closing it just before the matching `)}`. Keep `InsightsBatchProvider` where it is.

- [ ] **Step 3: Render the panel in the right rail + inline**

In the `<aside>` right-rail block, add the panel below `<AgentLog />`:

```tsx
                  <SectionInsight section="signals" label="Live signals" />
                  <SignalFeed />
                  <AgentLog />
                  <TokenSpendPanel />
```

And in the `<div className="xl:hidden">` block that renders `<AgentLog />` inline, add it below:

```tsx
            <div className="xl:hidden">
              <AgentLog />
              <TokenSpendPanel />
            </div>
```

- [ ] **Step 4: Wire Ask Bar bumpLive**

In `components/horizon/AskBar.tsx`, import the hook:

```ts
import { useSessionUsage } from "@/components/horizon/SessionUsageProvider";
```

Get `bumpLive` + `refresh`:

```ts
  const { bumpLive, refresh } = useSessionUsage();
```

Find where AskBar calls `start(url, body, opts)` (from `useAgentStream`). Add `onUsage` to the opts:

```ts
        onUsage: (u) => bumpLive(u),
```

After the stream completes (where AskBar handles `state === "done"`, e.g. in an effect watching the stream state), call `refresh()` once to reconcile against the DB. If there's no such effect, add:

```ts
  useEffect(() => {
    if (state === "done") refresh();
  }, [state, refresh]);
```

> Use the actual `state` field name AskBar destructures from `useAgentStream`. Read AskBar first to match its existing stream wiring.

- [ ] **Step 5: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual UI check (live dev server)**

With `npm run dev` running and signed in:
1. Load `/` — after sections settle, the **Tokens** pill appears in the right rail below Agent Log with a non-zero total.
2. Expand it — per-model rows + session total render.
3. Ask a question in the Ask Bar — total bumps immediately on completion.
4. Reload the page — total persists (same session).
5. (If feasible) log out + back in — total resets.

Capture screenshots for the PR.

- [ ] **Step 7: Commit**

```bash
git add "app/(banker)/page.tsx" components/horizon/AskBar.tsx
git commit -m "feat(usage): mount token-spend panel + wire Ask Bar live bump"
```

---

## Task 14: End-to-end smoke + docs

**Files:**
- Modify: `scripts/smoke-api.ts` (extend to assert /api/usage)
- Modify: `CLAUDE.md` (note the new surface + table) — optional but recommended

- [ ] **Step 1: Extend smoke-api.ts**

In `scripts/smoke-api.ts`, after the existing route checks, add a `/api/usage` GET assertion (it returns JSON, not SSE):

```ts
  // /api/usage — session token-spend summary (JSON, not SSE).
  try {
    const r = await fetch(`${BASE}/api/usage`, {
      headers: { Accept: "application/json", Cookie: cookie },
    });
    const j = (await r.json()) as {
      models?: unknown[];
      totals?: { inputTokens?: number; outputTokens?: number };
    };
    const ok =
      r.status === 200 &&
      Array.isArray(j.models) &&
      typeof j.totals?.inputTokens === "number";
    console.log(`${ok ? "PASS" : "FAIL"}  GET /api/usage (status ${r.status})`);
  } catch (e) {
    console.log(`FAIL  GET /api/usage — ${String(e)}`);
  }
```

- [ ] **Step 2: Run the full smoke (live dev server + sf:login)**

Run: `npm run sf:login` then (with dev server up) `npm run smoke:api`
Expected: all rows PASS, including `GET /api/usage`. (Run after at least one agent route has fired so the summary is populated; an empty-but-well-formed summary also passes.)

- [ ] **Step 3: Update CLAUDE.md (optional)**

Add `app/api/usage/route.ts` to the project-layout table and note the Token Spend panel under "Surfaces live on `/`". Add `token_usage` to the Data section.

- [ ] **Step 4: Final verification pass**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-api.ts CLAUDE.md
git commit -m "test(usage): smoke /api/usage + docs for token-spend panel"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Capture (T4, T8), persistence (T2), session id (T3), read endpoint (T9), live event (T5/T6/T10), provider store (T11), panel (T12), placement + Ask Bar bump (T13), both stacks (T4 main + T8 ask-data/analyze), exact-or-estimate (T1 + T4 + T8), smoke (T14). All spec sections map to a task.
- **Type consistency:** `RunUsage` (counts+exact, no model) is produced by the loops; `model` is stamped in provider.ts (T5) and in askDataAgent/analyzeAgent (T8). The SSE `usage_meta` shape (`{model,inputTokens,outputTokens,exact}`) is identical in `lib/sse/stream.ts` (T6), `AgentEvent` (T4), `useAgentStream` (T10), and `bumpLive` (T11). `SessionUsageSummary` is defined server-side in `lib/db/tokenUsage.ts` (T2) and re-declared identically client-side in `SessionUsageProvider.tsx` (T11) to avoid importing server code into a client component.
- **Risk to confirm early (T4 Step 6 / T9 Step 3):** whether Heroku Managed Inference emits a `usage` chunk. If `exact` is always false on real runs, that's expected degradation, not a bug — the panel shows `≈`.
- **Read-before-edit:** T7 (10 routes), T8 (analyzeAgent terminal event), and T13 (AskBar stream wiring) require reading the target file first to match existing variable names and event branches.
