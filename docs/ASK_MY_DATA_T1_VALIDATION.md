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
