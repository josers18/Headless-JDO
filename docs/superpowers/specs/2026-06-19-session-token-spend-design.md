# Session Token-Spend Panel — Design

> Status: approved-for-planning · Owner: Jose · Date: 2026-06-19

## 1. Problem & Goal

Horizon makes many LLM calls per login session — most of them in background
section runs (Morning Brief, Priority Queue, Portfolio Pulse, Pre-Drafted
Actions, Today's Arc, Insights, Pulse Strip), not just the Ask Bar. There is
currently no visibility into how many tokens those calls consume.

**Goal:** a collapsed-by-default **expandable section in the right rail** that
shows token spend for the current login session — **input and output tokens per
model**, with per-model subtotals and a grand total — persisted in Postgres so
it survives page reloads.

This is a transparency feature, consistent with Horizon's "reasoning is
transparent" principle. It is **not** a dashboard, not a cost/billing view, and
not a cross-session analytics surface.

## 2. Non-Goals (YAGNI)

- No dollar/cost conversion.
- No charts or sparklines.
- No historical trend across sessions.
- No per-route breakdown in the UI (route is stored for debugging only).
- No admin/multi-user aggregation.

## 3. Constraints (from CLAUDE.md)

- No new frameworks/LLM providers/UI libraries.
- Streaming-first: agent routes stay SSE; never block-and-return.
- All model calls go through `lib/llm/provider.ts#runAgentWithMcp`.
- Tailwind only; design tokens from `components/brand/tokens.ts`.
- `console.log` forbidden — use `lib/log.ts`.
- TS strict, `noUncheckedIndexedAccess: true`.
- A DB failure must never break an agent run (fire-and-forget writes).

## 3a. Two Inference Stacks (both must be covered)

Horizon has **two** OpenAI-compatible agent runners. Token capture must land in
both, or the panel under-counts:

1. **`lib/llm/heroku.ts#runAgent`** (via `lib/llm/provider.ts#runAgentWithMcp`)
   — home-page sections + Ask Bar: `/api/{ask,brief,priority,pulse,drafts,arc,
   prep,insights,pulse-strip,client}`.
2. **`lib/inference/heroku.ts#streamHeroku`** — used by
   `lib/inference/askDataAgent.ts` and `lib/inference/analyzeAgent.ts`, serving
   `/api/ask-data` and `/api/analyze-ask`.

The capture mechanism (`stream_options.include_usage`, accumulate from
`chunk.usage`, estimate fallback) is identical in both; the difference is the
surface that returns/forwards the totals. Both write `token_usage` rows and emit
`usage_meta`.

## 4. Architecture Overview

```
runAgent (heroku.ts)                         ← capture per-iteration usage
   │  returns AgentRunResult.usage
   ▼
runAgentWithMcp (provider.ts)                ← attribute model, write 1 DB row,
   │  emits usage via onEvent + returns       emit "usage_meta" through onEvent
   ▼
SSE route (e.g. /api/ask)                    ← forward usage_meta frame
   │
   ├──SSE "usage_meta"──► useAgentStream ───► SessionUsageProvider (live bump)
   │
   └── DB row (token_usage) ◄── GET /api/usage ──► SessionUsageProvider (truth)
                                                        │
                                                        ▼
                                              TokenSpendPanel (right rail)
```

Two feeds, one source of truth:
- **DB (`token_usage`)** is authoritative. `GET /api/usage` sums the current
  session's rows grouped by model. The panel fetches on mount, on window focus,
  and after any agent run completes.
- **Live `usage_meta` SSE event** gives instant feedback the moment a run
  finishes (before the DB refetch lands), so the Ask Bar feels responsive.

## 5. Component Design

### 5.1 Token capture — `lib/llm/heroku.ts`

Each `client.chat.completions.create(...)` in the loop adds:

```ts
stream_options: { include_usage: true }
```

OpenAI-compatible streams emit a final chunk with `chunk.usage` when this flag
is set **and** the upstream supports it. In the stream-drain loop, accumulate:

```ts
let runInputTokens = 0;
let runOutputTokens = 0;
let usageExact = false;            // true once any real usage chunk seen
// inside `for await (chunk ...)`:
if (chunk.usage) {
  runInputTokens  += chunk.usage.prompt_tokens     ?? 0;
  runOutputTokens += chunk.usage.completion_tokens ?? 0;
  usageExact = true;
}
```

The `usage` chunk typically has an empty `choices` array — the existing
`chunk.choices[0]?.delta` guard already tolerates that; no change needed there.

**Estimation fallback.** If no usage chunk arrives for the whole run
(`usageExact === false`), estimate from text length: sum the character length of
all `messages` sent on the final iteration for input and the accumulated
assistant content for output, divide by 4 (chars-per-token heuristic), and mark
`exact: false`. The estimate lives behind a small helper
`estimateTokens(text: string): number` so it is swappable later.

The finalize pass (post-iteration-cap completion) also includes
`stream_options` and contributes to the run totals.

`AgentRunResult` (and `RunAgentOutput`) gain:

```ts
usage: {
  model: string;          // modelIdFor(backend) — attributes Kimi fallback correctly
  inputTokens: number;
  outputTokens: number;
  exact: boolean;         // false when any portion was estimated
};
```

`model` is set in `provider.ts` (which knows the resolved backend), not in
`heroku.ts`; `heroku.ts` returns counts + `exact`, and `provider.ts` stamps the
model id when it wraps the result via `withInferenceBackend`.

### 5.2 Persistence — `lib/db/schema.sql` + `lib/db/tokenUsage.ts`

New table (idempotent; applied by the existing release-phase runner
`scripts/apply-schema.cjs`):

```sql
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

New module `lib/db/tokenUsage.ts` (mirrors `lib/db/queries.ts` pool pattern):

```ts
export async function recordTokenUsage(row: {
  userId: string; sessionId: string; route: string; model: string;
  inputTokens: number; outputTokens: number; exact: boolean;
}): Promise<void>;

export interface SessionUsageSummary {
  models: Array<{ model: string; inputTokens: number; outputTokens: number; exact: boolean }>;
  totals: { inputTokens: number; outputTokens: number; exact: boolean };
}
export async function summarizeSessionUsage(sessionId: string): Promise<SessionUsageSummary>;
```

`summarizeSessionUsage` runs a `group by model` sum; `exact` per model is
`bool_and(exact)` (a model is "exact" only if every contributing run was exact);
the grand-total `exact` is `bool_and` across all rows.

### 5.3 Session identity — `hz_sid` cookie

A login session needs a stable id. At `/callback`
(`app/api/auth/salesforce/callback/route.ts`, where `hz_sf` is already written)
also set `hz_sid` = a UUID (`crypto.randomUUID()`), `httpOnly`, same lifetime as
`hz_sf`. Reload → same cookie → same tally. New login → new sid → fresh tally.

A helper `getSessionId()` in `lib/salesforce/token.ts` reads `hz_sid`; if absent
(e.g. a session that predates this feature), it returns a stable fallback
derived from the `hz_sf` user id so old sessions still tally (`legacy:<userId>`).

### 5.3a Token capture — `lib/inference/heroku.ts#streamHeroku`

`streamHeroku` is a generator that yields normalized events. Apply the same
capture: add `stream_options: { include_usage: true }` to its
`chat.completions.create`, accumulate `chunk.usage` into run totals, and yield a
new normalized event `{ kind: "usage"; inputTokens; outputTokens; exact }` (with
the estimate fallback) before the generator returns. `HerokuInferenceEvent`
gains this variant. `askDataAgent` and `analyzeAgent` consume that event,
stamp `modelId` (already returned by `streamHeroku`/`clientFor`), and are
responsible for: (a) writing the `token_usage` row, and (b) forwarding
`usage_meta` to their SSE route. `/api/ask-data` and `/api/analyze-ask` pass
`userId`/`sessionId`/`route` down to these agents.

### 5.4 Wiring — `lib/llm/provider.ts`

`RunAgentInput` gains optional `userId?`, `sessionId?`, `route?`. After the run
completes (in the `try`, before `return`), fire-and-forget:

```ts
void recordTokenUsage({
  userId: input.userId ?? "unknown",
  sessionId: input.sessionId ?? "unknown",
  route: input.route ?? input.routeHint ?? "unknown",
  model: result.usage.model,
  inputTokens: result.usage.inputTokens,
  outputTokens: result.usage.outputTokens,
  exact: result.usage.exact,
}).catch((e) => log.warn("token_usage.write_failed", { error: String(e) }));
```

It also emits the live event through the same `onEvent` the routes already pass:

```ts
input.onEvent?.({ type: "usage_meta", usage: result.usage });
```

`AgentEvent` in `heroku.ts` gains the `usage_meta` variant (so the type flows
through `onEvent`); the actual emission happens in `provider.ts` after the run,
because that is where the model id is known. (Routes that build their own
`onEvent` forwarder need a one-line passthrough — see 5.5.)

Each SSE route passes `userId`, `sessionId`, `route` into `runAgentWithMcp`.
Routes already compute `bankerUserId`; they additionally call `getSessionId()`
and pass a literal route name (e.g. `"ask"`).

### 5.5 SSE event — `lib/sse/stream.ts` + routes

`SseEvent` gains:

```ts
| { type: "usage_meta"; usage: { model: string; inputTokens: number; outputTokens: number; exact: boolean } }
```

A helper `sendUsageMeta(send, usage)` mirrors `sendInferenceMeta`. Each route's
`onEvent` forwarder adds:

```ts
else if (e.type === "usage_meta" && e.usage) send({ type: "usage_meta", usage: e.usage });
```

### 5.6 Read endpoint — `app/api/usage/route.ts`

`GET /api/usage` (nodejs runtime, `force-dynamic`): resolves `getSessionId()`
server-side, calls `summarizeSessionUsage`, returns the `SessionUsageSummary`
JSON. 401 if unauthenticated. This is a plain JSON read (not SSE) — it does not
violate the streaming rule, which applies to **agent** calls.

### 5.7 Client store — `SessionUsageProvider` + `useSessionUsage`

A React context provider (mounted inside `HorizonSignedIn`, alongside the other
providers) exposing:

```ts
{ data: SessionUsageSummary | null; loading: boolean; refresh: () => void;
  bumpLive: (u: { model; inputTokens; outputTokens; exact }) => void }
```

- `refresh()` → `GET /api/usage`, sets `data`. Called on mount and on
  `window` `focus`.
- `bumpLive(u)` → optimistically merges one run's usage into `data` (adds to the
  matching model + totals) for instant feedback, then a `refresh()` reconciles
  against the DB shortly after.

`useAgentStream` already parses SSE; add a `usage_meta` case to `IncomingEvent`
and `applyEvent`, exposing the latest run usage via a new `onUsage?` callback in
`start(...)`'s opts, OR via a returned `lastUsage` field. The Ask Bar (and any
caller) wires `onUsage` → `sessionUsage.bumpLive`. Background section components
do not need wiring — their spend is captured server-side and appears on the next
`refresh()`/focus.

### 5.8 The panel — `components/horizon/TokenSpendPanel.tsx`

Structurally mirrors `AgentLog.tsx`:

- Collapsed: a pill row — `Tokens · 48.2k` (grand total in/out combined, humanized
  with `k`/`M`), with a chevron. Hidden entirely when `data` is null/empty.
- Expanded: a compact table — one row per model: `model · in · out · subtotal`,
  then a grand-total row. An `≈` marker (with a tooltip "includes estimated
  counts") shows when any contributing row is `exact: false`.
- Tailwind only, design tokens, `text-[10px] uppercase tracking` chrome to match
  `AgentLog`. Keyboard-accessible toggle button (consistent with AgentLog).

Mounted in the **right rail** in `app/(banker)/page.tsx`, directly below
`AgentLog` in the `<aside>` (xl+), and inline at page foot on `<1280px` — same
dual placement AgentLog uses.

## 6. Data Flow (worked example)

1. Banker opens `/` → sections fire their SSE routes. Each run writes a
   `token_usage` row (model = claude-4-5-sonnet) and emits `usage_meta`.
2. `SessionUsageProvider` mounts → `GET /api/usage` → shows running total.
3. Banker asks a question in the Ask Bar → run finishes → `usage_meta` arrives
   → `bumpLive` updates the panel instantly → `refresh()` reconciles.
4. Banker reloads the page → same `hz_sid` cookie → `GET /api/usage` returns the
   accumulated total → panel shows continuity.
5. Banker logs out and back in → new `hz_sid` → tally resets.

## 7. Error Handling & Degradation

- **No usage from upstream:** estimate path, `exact: false`, panel shows `≈`.
- **DB write fails:** logged, swallowed — agent run unaffected.
- **`GET /api/usage` fails:** provider keeps last good `data`; panel does not
  crash (renders last known or nothing).
- **Missing `hz_sid` (legacy session):** `legacy:<userId>` fallback id; tally
  still accumulates, just not isolated to a single browser session.

## 8. Testing

- **Unit:** `estimateTokens` heuristic; `summarizeSessionUsage` grouping +
  `bool_and` exact logic (against a seeded test DB or a thin query mock).
- **Capture:** a `runAgent` test asserting `result.usage` is populated from a
  mocked stream that emits a `usage` chunk, and the estimate path when it does
  not.
- **Smoke:** `npm run smoke:api` extended (or a manual curl) to confirm
  `/api/usage` returns a well-formed summary after one `/api/ask` run; confirm a
  `usage_meta` frame appears in the `/api/ask` SSE stream.
- **Manual UI:** panel appears in right rail, expands, shows per-model rows,
  survives reload, resets on re-login. Screenshots in the PR.

## 9. Files Touched

| File | Change |
|------|--------|
| `lib/llm/heroku.ts` | `stream_options.include_usage`; accumulate usage; `estimateTokens`; `usage` on `AgentRunResult`; `usage_meta` on `AgentEvent` |
| `lib/llm/provider.ts` | stamp model on usage; write DB row (fire-and-forget); emit `usage_meta`; `userId`/`sessionId`/`route` on `RunAgentInput`; `usage` on `RunAgentOutput` |
| `lib/inference/heroku.ts` | `stream_options.include_usage`; accumulate usage; new `usage` event on `HerokuInferenceEvent` |
| `lib/inference/askDataAgent.ts`, `lib/inference/analyzeAgent.ts` | consume `usage` event; write DB row; forward `usage_meta`; accept `userId`/`sessionId`/`route` |
| `app/api/ask-data/route.ts`, `app/api/analyze-ask/route.ts` | pass `userId`/`sessionId`/`route`; forward `usage_meta` |
| `lib/db/schema.sql` | `token_usage` table + index |
| `lib/db/tokenUsage.ts` | **new** — `recordTokenUsage`, `summarizeSessionUsage` |
| `lib/salesforce/token.ts` | `getSessionId()` helper (reads `hz_sid`, legacy fallback) |
| `app/api/auth/salesforce/callback/route.ts` | set `hz_sid` cookie |
| `lib/sse/stream.ts` | `usage_meta` `SseEvent` + `sendUsageMeta` |
| `app/api/{ask,brief,priority,pulse,drafts,arc,prep,insights,pulse-strip,client/[id]}/route.ts` | pass `userId`/`sessionId`/`route`; forward `usage_meta` in `onEvent` |
| `app/api/usage/route.ts` | **new** — `GET` session summary |
| `lib/client/useAgentStream.ts` | parse `usage_meta`; expose `onUsage`/`lastUsage` |
| `lib/client/SessionUsageProvider.tsx` (or under `components/horizon/`) | **new** — context + `useSessionUsage` |
| `components/horizon/TokenSpendPanel.tsx` | **new** — the panel |
| `app/(banker)/page.tsx` | mount provider + panel (right rail + inline) |

## 10. Open Risks

- **Heroku Managed Inference may not emit a `usage` chunk on streamed
  completions.** If so, every count is an estimate (`exact: false`). The design
  degrades cleanly, but if exact counts matter, a follow-up could add a
  non-streaming token-count probe. Validate empirically during implementation
  (log `usageExact` on the first real run).
- **Two stacks, kept in sync:** capture logic is duplicated across
  `lib/llm/heroku.ts` and `lib/inference/heroku.ts` (§3a). They are genuinely
  separate code paths today, so extracting a shared helper for the
  accumulate-and-estimate step (`estimateTokens` + a "fold a usage chunk"
  function, e.g. in `lib/llm/tokenUsageCapture.ts`) avoids drift between them.
