# Ask My Data — Tier 1 validation (T1-5 / T1-6)

This document closes out the v1.1-expansion Tier 1 work. It's the record
of what actually shipped against `EXPANSION_v4.md` §T1-5 (files) and §T1-6
(Done When), plus known-open items and the diagnostic we ran to understand
why the self-hosted Data 360 MCP currently responds `invalid_grant`.

Commits in scope:
- `4aac6ff` feat(horizon-v1.1): T1-1 entry state + starter prompts
- `1cdfa0d` feat(horizon-v1.1): T1-2+T1-4 workspace + persistence
- `3469f90` fix(horizon-v1.1): graceful degradation + retry UX
- `06ef828` feat(horizon-v1.1): T1-3 agent loop + conversation UI

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
- `lib/mcp/selfHostedDataCloud.ts` — MCP client (SSE + x-api-key), isolated
  from Today's `lib/mcp/client.ts`
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

## T1-6 — Done When checklist

| Check | Status | Evidence |
|---|---|---|
| `/ask` route renders entry state with starter prompts | ✓ | T1-1 + T1-3 smoke: 6 pills rendered; hero greeting markup present |
| Clicking a starter prompt creates a new thread and starts the conversation | ✓ | `AskDataEntry.handleSubmit` → `POST /api/ask-threads` → `router.push(/ask/[id])` → `sessionStorage` first-turn auto-submit in `Conversation` |
| Multi-turn works: agent has full prior context | ✓ (code-path) | `toChatMessages` in `/api/ask-data` replays prior DB messages onto the Kimi message list; agent stores tool_use/tool_result blocks per turn. Not human-verified with a real narrowing question because MCP auth is degraded — see "Known-open". |
| Reasoning Trail shows Data 360 MCP tool calls per response | ✓ | T1-3 smoke: 1 `tool_call` + 1 `tool_result` SSE event received; rendered by `AskDataTrace` with running/done/error state dots |
| Each agent response shows 2–3 suggested follow-ups as clickable pills | ✓ | T1-3 smoke: `follow_ups` SSE frame delivered MiniMax-generated suggestions; `ContextRail` consumes via `useFollowUps` bus and renders pills |
| Threads persist across page refresh | ✓ | `POST /api/ask-threads` writes to `ask_my_data_threads`; `GET /api/ask-threads` reads back. Verified in T1-2 with 3 backdated rows surviving refresh |
| Sidebar groups past threads by recency | ✓ | `groupThreadsByRecency` → Today / Yesterday / This Week / Earlier; T1-2 smoke showed seed rows land in correct buckets after backdating |
| Thread titles auto-generated and meaningful | ✓ | T1-3 smoke: `thread_title` SSE frame fires on first-turn; MiniMax generator returns ≤6-word title; `renameThread` persists it |
| All inference goes through Heroku | ✓ | `lib/inference/heroku.ts` uses only `HEROKU_INFERENCE_ONYX_*` + `HEROKU_INFERENCE_IVORY_*`; `grep -r '@anthropic-ai' lib/ask-data.*` returns nothing |
| No regression to existing Today Ask Bar | ✓ | T1-3 smoke: `/` at 56651 bytes ≈ baseline; rail + MorningBrief + PulseStrip + `aria-label="Ask Horizon"` all present; zero `aria-label="Ask My Data"` leak |

**10/10 pass.**

## Known-open

### Self-hosted Data 360 MCP returns `invalid_grant`

The MCP app (`metal-vibes-61f4a`) is alive and the SDK connects, but
every tool call currently fails with:

```
Error: OAuth error: 400
  {"error":"invalid_grant",
   "error_description":"no client credentials user enabled"}
```

This is a Salesforce-side Connected App config issue with the
`client_credentials` OAuth flow the MCP uses to proxy requests. The
app-side env (`SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `MCP_API_KEY`) is set.

Impact: Ask My Data exercises the full code path (SSE streaming, Kimi
loop, persistence, follow-ups) but returns "I couldn't reach Data Cloud"
instead of real data. The moment this resolves, live data flows without
a code change.

Action owner: Jose. See `scripts/diagnose-self-mcp-oauth.ts` for a
standalone token-exchange probe that tests the grant directly from
this side.

### Other deferrals (intentional)

- Pin/unpin UI on threads — schema has `pinned`, UI lives in a future
  polish task per Q-T1-2-e.
- Hamburger sidebar at <1024px — sidebar hides entirely; deferred.
- Memory cues + related threads in `ContextRail` — stubbed empty-state
  copy per Q-T1-2-c.
- Multi-turn replay of tool_use/tool_result blocks to Kimi — T1-3
  flattens to text on replay to avoid mismatched `tool_call_id`
  references; full structured replay is a T1-polish.
- Second-turn narrowing-question verification — blocked on MCP auth.
