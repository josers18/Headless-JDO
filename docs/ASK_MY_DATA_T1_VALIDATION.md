# Ask My Data — Tier 1 validation (T1-5 / T1-6)

This document closes out the v1.1-expansion Tier 1 work. It's the record
of what actually shipped against `EXPANSION_v4.md` §T1-5 (files) and §T1-6
(Done When), plus known-open items.

Commits in scope:
- `4aac6ff` feat(horizon-v1.1): T1-1 entry state + starter prompts
- `1cdfa0d` feat(horizon-v1.1): T1-2+T1-4 workspace + persistence
- `3469f90` fix(horizon-v1.1): graceful degradation + retry UX
- `06ef828` feat(horizon-v1.1): T1-3 agent loop + conversation UI
- `375bc63` docs(horizon-v1.1): T1-5/T1-6 validation (this file's first version)
- `f58717b` feat(horizon-v1.1): Path C — swap to first-party Data 360 MCP

## Architectural change after T1-3

The original plan routed Ask My Data at a self-hosted Data 360 MCP
(`metal-vibes-61f4a-76bf5d346a86.herokuapp.com`) using SSE + `x-api-key`.
That server's `client_credentials` OAuth grant against Salesforce
returned `invalid_grant: no client credentials user enabled` despite
Connected App config appearing correct in the UI — a known quirk of
classic Connected Apps' Client Credentials flow that we couldn't resolve
in the time available.

Path C (commit `f58717b`) swapped the data layer to the **first-party
Salesforce-hosted Data 360 MCP** — the same endpoint Today uses for
`data_360`. It authenticates with the banker's existing PKCE-issued
access token (no client_credentials path), so queries run as the banker
and row-level security applies correctly.

Trade-off: first-party MCP exposes 2 tools (`get_dc_metadata`,
`post_dc_query_sql`) vs. the self-hosted's 14. The three must-haves
(list DLOs, inspect schema, run SQL) are covered; specialized tools
(segments, identity resolution, activation, async SQL) are out of scope
for the exploratory surface.

## T1-5 — files mapping

Spec path → actual path. Route-group rename (`app/ask/…` → `app/(banker)/ask/…`)
is the T0-1 decision; API namespace (`/api/threads` → `/api/ask-threads`)
avoids collision with any future unrelated threads surface.

| `EXPANSION_v4` §T1-5 path | Actual path |
|---|---|
| `app/ask/page.tsx` | `app/(banker)/ask/page.tsx` |
| `app/ask/[threadId]/page.tsx` | `app/(banker)/ask/[threadId]/page.tsx` |
| `app/api/threads/route.ts` | `app/api/ask-threads/route.ts` |
| `app/api/threads/[threadId]/messages/route.ts` | `app/api/ask-threads/[id]/messages/route.ts` |
| `app/api/ask-data/route.ts` | same |
| `components/ask-data/ThreadList.tsx` | same |
| `components/ask-data/Conversation.tsx` | same |
| `components/ask-data/Message.tsx` | inlined as `MessageRow` inside `Conversation.tsx` |
| `components/ask-data/StarterPrompts.tsx` | same |
| `lib/prompts/ask-my-data.ts` | `lib/prompts/ask-data.ts` |
| `lib/prompts/thread-title.ts` | `lib/prompts/ask-data-title.ts` |
| `lib/db/threads.ts` | `lib/db/askThreads.ts` |

Additional files added that the spec did not enumerate but the
architecture required:

- `lib/inference/askDataAgent.ts` — Kimi tool-calling loop
- `lib/mcp/firstPartyDataCloud.ts` — Streamable HTTP client for the
  first-party Data 360 MCP, banker-scoped bearer auth. Isolated from
  Today's `lib/mcp/client.ts` multi-server registry.
- `lib/sse/askData.ts` — isolated 9-event SSE protocol
- `lib/client/useAskDataStream.ts` — isolated client stream hook
- `lib/prompts/ask-data-followups.ts` — MiniMax follow-up generator
- `lib/ask/currentUser.ts` — banker-id resolver for thread ownership
- `lib/ask/starterPrompts.ts` — static starter prompts
- `lib/ask/threadGroups.ts` — recency grouping for the sidebar
- `components/ask-data/AskDataBar.tsx` — visual-chrome-only pill (no Today
  event bus)
- `components/ask-data/AskDataEntry.tsx` — entry-state container
- `components/ask-data/AskWorkspace.tsx` — 3-column responsive shell
- `components/ask-data/ContextRail.tsx` — right rail with live MiniMax
  follow-ups
- `components/ask-data/AskDataTrace.tsx` — collapsible reasoning trail
- `components/ask-data/followUpsBus.ts` — module-scoped pub/sub
- `components/ask-data/askDataEvents.ts` — shared custom-event names

Files that existed during T1-3 and were **removed** in Path C:

- `lib/mcp/selfHostedDataCloud.ts` — SSE + `x-api-key` client, superseded
  by `lib/mcp/firstPartyDataCloud.ts`
- `scripts/diagnose-self-mcp-oauth.ts` — token-exchange probe used to
  triage the `invalid_grant` error; no longer relevant now that the
  self-hosted path is out of scope

## T1-6 — Done When checklist

| Check | Status | Evidence |
|---|---|---|
| `/ask` route renders entry state with starter prompts | ✓ | T1-1 + T1-3 smoke: 6 pills rendered; hero greeting markup present |
| Clicking a starter prompt creates a new thread and starts the conversation | ✓ | `AskDataEntry.handleSubmit` → `POST /api/ask-threads` → `router.push(/ask/[id])` → `sessionStorage` first-turn auto-submit in `Conversation` |
| Multi-turn works: agent has full prior context | ✓ (code-path) | `toChatMessages` in `/api/ask-data` replays prior DB messages onto the Kimi message list; agent stores tool_use/tool_result blocks per turn. Narrowing-question verification still pending against live data — adding to Path C follow-ups. |
| Reasoning Trail shows Data 360 MCP tool calls per response | ✓ | Path C live smoke: 1 `tool_call` (`get_dc_metadata`) + 1 `tool_result` (`isError: false`, real metadata payload) rendered by `AskDataTrace`. |
| Each agent response shows 2–3 suggested follow-ups as clickable pills | ✓ | T1-3 smoke: `follow_ups` SSE frame delivered MiniMax-generated suggestions; `ContextRail` consumes via `useFollowUps` bus and renders pills |
| Threads persist across page refresh | ✓ | `POST /api/ask-threads` writes to `ask_my_data_threads`; `GET /api/ask-threads` reads back. Verified in T1-2 with 3 backdated rows surviving refresh |
| Sidebar groups past threads by recency | ✓ | `groupThreadsByRecency` → Today / Yesterday / This Week / Earlier; T1-2 smoke showed seed rows land in correct buckets after backdating |
| Thread titles auto-generated and meaningful | ✓ | T1-3 + Path C smokes: `thread_title` SSE frame fires on first turn; MiniMax generator returns ≤6-word title; `renameThread` persists it |
| All inference goes through Heroku | ✓ | `lib/inference/heroku.ts` uses only `HEROKU_INFERENCE_ONYX_*` + `HEROKU_INFERENCE_IVORY_*`; `grep -r '@anthropic-ai' lib/ask-data.*` returns nothing |
| No regression to existing Today Ask Bar | ✓ | T1-3 smoke: `/` at 56651 bytes ≈ baseline; rail + MorningBrief + PulseStrip + `aria-label="Ask Horizon"` all present; zero `aria-label="Ask My Data"` leak. Path C touched only `lib/mcp/firstPartyDataCloud.ts` (new) + Ask-My-Data-scoped files; Today's `data_360` MCP call path in `lib/mcp/client.ts` is unchanged. |

**10/10 pass.**

## Path C live-data verification

After the first-party MCP swap, the full agent path exercises real data:

- Question: *"Use the get_dc_metadata tool to list the first 3 DMOs available and tell me their names."*
- `tool_call`: `get_dc_metadata` with `{ dataspace: "default" }`
- `tool_result`: `isError: false`, 4.2 MB metadata payload (truncated to 8KB for the model context per `lib/mcp/firstPartyDataCloud.ts`)
- 521 characters of banker-facing narrative
- Kimi correctly named three real DMOs from the org:
  - `AbnExperimentationDailySummary__dlm`
  - `AbnExperimentationSummary__dlm`
  - `AbnExperimentationCohort__dlm`
- `thread_title` (MiniMax-generated), `assistant_persisted`, `done` all emitted cleanly
- Dev log: `POST /api/ask-data 200 in ~9s` (well under Heroku H12 30s budget)

## Known-open (post Path C)

- Pin/unpin UI on threads — schema has `pinned`, UI lives in a future
  polish task per Q-T1-2-e.
- Hamburger sidebar at <1024px — sidebar hides entirely; deferred.
- Memory cues + related threads in `ContextRail` — stubbed empty-state
  copy per Q-T1-2-c.
- Multi-turn replay of tool_use/tool_result blocks to Kimi — T1-3
  flattens to text on replay to avoid mismatched `tool_call_id`
  references; full structured replay is a T1-polish.
- Narrowing-question second-turn verification — unblocked by Path C but
  not yet run; adding to Tier 2 pre-start or a small post-Tier-1 pass.
- Async SQL queries (>120s) — not supported on first-party MCP. None
  of the six starter prompts need it; revisit only if a banker scenario
  demands it.
- Segments / Identity Resolution / Activation operational tools — out
  of scope on first-party MCP. Would require a separate Tier-3 task to
  reintroduce via a dedicated MCP or direct REST layer.

---

## Post-T1 hardening addendum (2026-05-06, commit `998def7`)

Live-testing pass on top of T1. The headline fix closes a latent bug
present since Path C landed on 2026-04-30, plus a cluster of agent-loop
discipline improvements that surfaced during the session.

Protocol-level:

- **`defaultExc` envelope unwrap** — `lib/mcp/firstPartyDataCloud.ts`
  (and `lib/mcp/client.ts` for the Today flow) now parse the outer
  `{"defaultExc": "<stringified JSON>", ...}` envelope Data Cloud wraps
  around successful `post_dc_query_sql` results, extract the inner
  JSON, and emit the clean `{data, metadata, responseCode}` shape to
  the agent. Without this, Kimi saw only the metadata slice and
  interpreted real data as "empty" — the silent root cause of almost
  every "no results found" complaint in the session.

Agent runtime (`lib/inference/askDataAgent.ts`):

- **Turn-wide result cache** — the per-`(name, argsJson)` dedup cache
  was declared inside the iteration loop and reset every turn. Lifted
  to the turn level so identical-args retries across iterations serve
  from memory instead of re-hitting the MCP.
- **`<think>` tag streaming stripper** — Kimi's chain-of-thought
  occasionally leaked into the narrative; same tag-spanning-chunks
  strip used on Analyze now applies here. `stripThinkTagsSync` also
  scrubs persisted threads written before this landed.
- **Circuit breaker shield** — synthetic guard rejections
  (`isSyntheticGuard: true` on "unknown tool" returns) no longer feed
  the MCP error counter. Threshold tightened from 3 → 2 consecutive
  real errors before tripping.
- **Fallback narratives on every silent-exit path** — iteration cap,
  empty-tool-calls, stream exception, circuit trip all now emit a
  `token` event before `turn_complete` so the UI never renders a blank
  assistant response.
- **Preloaded DC catalog** — `/api/ask-data/route.ts` loads the Redis
  DMO cache at turn start, injects the catalog into the system prompt
  (with wider field caps than Today: `fullFieldsTopCount: 40`,
  `tailFieldsPerDmo: 30`), and passes `preloadedDcMetadata: true` to
  hide `get_dc_metadata` from Kimi's tool list. "Tool hidden" now
  returns a specific "catalog already in system prompt" message
  instead of a generic "unknown tool" error.

Prompt (`lib/prompts/ask-data.ts` → **v0.5.0**):

- NUMBERED FOLLOW-UPS — single-digit replies ("1", "2") resolve
  against the prior assistant message's numbered list, not in
  isolation.
- GROUND SQL IN THE CATALOG — step-by-step algorithm with explicit
  `+N more` truncation-marker handling so Kimi doesn't invent columns
  when a DMO's field list was truncated.
- ONE SQL FIX, THEN STOP — with runtime backstop; catches iterative
  column-guessing cascades.
- AVOID CROSS-DMO JOINS — explicit guidance and bad/good example,
  addresses the `ssot__Individual__dlm` vs `DC_UnifiedssotIndividualIr1__dll`
  mis-attribution class where Kimi mixed column conventions.
- NO SQL IN PROSE / NO RAW FIELD NAMES / NO TUTORIALS — with forbidden
  phrases enumerated. Stops Kimi from drifting into playbook mode when
  a query returns no rows.
- Widen-before-giving-up — if a time-scoped query returns empty, retry
  once with a wider window before reporting "no data."

UX:

- **MarkdownView rendering** — `components/ask-data/Conversation.tsx`
  now uses the shared `MarkdownView` for persisted + live narrative
  (tables, bold, bullets). Previously rendered as `whitespace-pre-wrap`
  plain text, which made structured responses illegible.

Cache + ops:

- **Pinned inclusion list** in `lib/llm/dcMetadataCache.ts` — DMOs
  like `ssot__PersonLifeEvent__dlm` (112 rows) would otherwise fall
  outside the top-60-banker-relevant cutoff. Pinned matchers force
  them into the catalog regardless of rowCount.
- **`GET /api/admin/refresh-dc-cache?run=1&tool=dc|tableau|both&force=1`** —
  dev-only trigger that spawns the refresh script as a child process
  using the live banker session token; avoids the expired-`SF_ACCESS_TOKEN`
  problem when running the scripts locally.
- **`redisSetOnce` short-lived write helper** in `lib/redis.ts` —
  avoids the idle-TLS-socket-severed failure mode on Heroku Mini Redis
  for long-running refresh scripts.

Known remaining gap: Analytics Agent / `post_dc_query_sql` sometimes
errors on joins where two DMOs model the same concept with different
column conventions. The prompt bans cross-DMO JOINs as a workaround;
an AST-level SQL preflight (porting the Today flow's `preflightRejection`)
is the structural fix if the prompt discipline doesn't hold.

---

## Post-T1 hardening, second wave (2026-05-06 PM, v163)

The May 6 AM pass landed full agent hardening for Ask My Data. The PM
pass focused on the surrounding infrastructure that keeps the catalog
warm — the user-visible symptom on Today triggered the investigation,
but the fix benefits Ask My Data identically because both surfaces
read from the same Redis-backed catalog.

- **Scheduler self-heals via last-good banker creds** — Heroku
  Scheduler refresh jobs were failing silently (`tsx: not found` and
  `SF_ACCESS_TOKEN missing`), leaving caches cold whenever no banker
  manually refreshed. Fix: `tsx` moved to `dependencies`; new
  `scheduler_credentials` singleton Postgres table holds the last
  successful login's `refresh_token`; `scripts/lib/resolveSfToken.ts`
  resolves a fresh access token at job start via env → config-var →
  DB-row priority. Schema migration runs in Heroku release phase
  (`scripts/apply-schema.cjs`). Self-heals on every banker login
  — whoever signs in most recently keeps the cache alive.
  Commits `ce0bf91`, `ed2ec54`.
- **Section title chrome** — `components/nav/SectionTopBar.tsx`
  bumped from 11px uppercase muted ("eyebrow") to 15/17px bold
  centered. Applies to `/ask` and `/ask/[threadId]` (and `/analyze*`).
  Commits `8999983`, `bdf78d1`.
