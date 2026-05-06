# `types/` — Shared TypeScript types

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Strict](https://img.shields.io/badge/strict-true-success)](https://www.typescriptlang.org/tsconfig#strict)
[![noUncheckedIndexedAccess](https://img.shields.io/badge/noUncheckedIndexedAccess-true-success)](https://www.typescriptlang.org/tsconfig#noUncheckedIndexedAccess)

Cross-cutting type definitions used by both server and client. Not a kitchen sink — most files in `lib/` define their own narrow interfaces. This folder is reserved for **domain types** (Horizon's MCP servers, brief items, signals, drafts) and **MCP protocol shapes** that have to round-trip across the server/client boundary.

> **Why a separate `types/` folder rather than colocating?** Three reasons: (1) `McpServerName` is referenced from MCP clients, agent loops, prompts, and ~20 UI components — colocating with any of them creates an awkward import direction; (2) the App Router boundary means a file imported from both Server and Client Components must be type-only, which is naturally enforced when types live in their own folder; (3) single-source-of-truth for the union types that govern reasoning-trail rendering and SF-vs-DC routing decisions.

## Files

### `horizon.ts`

The product's domain types — the shape of a Morning Brief item, a Priority Queue row, a draft action, a Today's Arc node. Most of the agent loops produce JSON conforming to these shapes; the React components consume them. Notable exports:

- **`McpServerName`** — the union of MCP server names: `"salesforce_crm" | "data_360" | "tableau_next" | "heroku_toolkit"`. Referenced everywhere for routing decisions, reasoning-trail rendering, and prompt phrasing.
- **`BriefItem`**, **`MorningBrief`** — the schema for `/api/brief` JSON output (greeting, items[], signoff, recent_life_events).
- **`PriorityClient`** — one row in the priority queue (client_id, name, reason, score, sources).
- **`PortfolioPulsePayload`**, **`PulseKpi`** — narrative + KPI list with delta direction.
- **`TodaysArcPayload`**, **`ArcNodePayload`** — timeline node + full arc shape.
- **`StreamedDraft`** — a pre-drafted action awaiting banker approval (kind, target client, body, executable endpoint).
- **`Signal`** — one entry in the live signal feed (severity, source, narrative, anchor IDs).
- **`ReasoningStep`** — one tool-call row in the reasoning trail (server, tool, input preview, status, output preview).
- **`BriefEntityLink`** — auxiliary anchors (extra Accounts/Contacts named in a brief item) so the UI can render multi-account inline links.

### `mcp.ts`

MCP protocol shapes — `tool_use` and `tool_result` content blocks, server config descriptors, the `McpServerConfig` shape used to bootstrap connections. Some legacy types here come from the Anthropic-direct era (when the agent used the SDK's `mcp_servers` parameter natively); the OpenAI-compat path doesn't use those, but they remain for the optional Heroku toolkit MCP wiring path. Notable exports:

- **`McpServerConfig`** — a registered MCP server (URL, name, bearer token).
- **`McpToolUseBlock`**, **`McpToolResultBlock`** — content-block shapes for tool calls + their results, kept for compatibility with any MCP-aware code path that consumes raw blocks.

### `ask-thread.ts`

Ask Bar (Today) multi-turn thread types. Re-exports OpenAI's `ChatCompletionMessageParam` as `AskThreadMessage` so the rest of the code uses Horizon-flavored names. The Ask My Data surface has its own thread schema in `lib/db/askThreads.ts` — this file is for the in-page Ask Bar's session-only memory.

- **`AskThreadMessage`** — alias of `ChatCompletionMessageParam`. Server-friendly tool-call format.
- **`ASK_THREAD_STORAGE_KEY`** — `localStorage` key used by the Ask Bar to persist its in-progress thread across page refreshes.

## Where domain types live elsewhere

Some domain types live in their owning module rather than this folder when they're truly internal:

| Domain | Where | Why |
|--------|-------|-----|
| Cached DC metadata envelope | `lib/llm/dcMetadataCache.ts` | Implementation detail of the cache reader. |
| Cached Tableau SDM envelope | `lib/llm/tableauSemanticCache.ts` | Same. |
| Chart spec (`AnalyzeChartType`, `ChartSpec`) | `lib/analyze/chartTypes.ts` | Single source of truth for the 18-chart palette. |
| Ask My Data thread + message rows | `lib/db/askThreads.ts` | Persistence-layer detail. |
| Stored token cookie shape | `lib/salesforce/token.ts` | Co-located with the cookie reader/writer. |
| Scheduler credentials row | `lib/db/schedulerCreds.ts` | Co-located with the singleton helper. |

If a type starts being shared by 3+ unrelated callers, lift it to `types/`.

## Conventions

- **Strict mode is on.** No `any` without a `// why:` comment. `noUncheckedIndexedAccess: true` — array reads always need an `undefined` check.
- **Server-safe.** Nothing in `types/` may import from `react`, `next`, browser APIs, or `pg` — these files have to be importable from anywhere.
- **Type-only.** Files here should have no runtime side effects. Constants are fine (e.g. `ASK_THREAD_STORAGE_KEY`); class instances are not.
- **No barrels.** Import from the specific file (`@/types/horizon`, not `@/types`) so the dependency graph is greppable.

## Related

- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — the request flow that produces these JSON shapes.
- [`lib/prompts/`](../lib/prompts/) — prompts that constrain the model to produce JSON matching these types.
- [`tsconfig.json`](../tsconfig.json) — strict-mode flags applied to this folder.
