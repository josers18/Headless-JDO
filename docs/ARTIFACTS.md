# Repository artifacts

What ships in this codebase (high level). Prompt versions change over time — see `MORNING_BRIEF_PROMPT_VERSION` and siblings in `lib/prompts/`.

## User-visible surfaces

| Surface | Client entry | Typical API |
|---------|----------------|-------------|
| Morning brief | `components/horizon/MorningBrief.tsx` | `POST /api/brief` (SSE) |
| Today’s arc | `components/horizon/TodaysArc.tsx` | `GET /api/arc` (SSE) |
| Priority queue | `components/horizon/PriorityQueue.tsx` | `GET /api/priority` (SSE) |
| Portfolio pulse | `components/horizon/PortfolioPulse.tsx` | `GET /api/pulse` (SSE) |
| Pulse strip (header) | `components/horizon/PulseStrip.tsx` | `GET /api/pulse-strip` (SSE) |
| Pre-drafted actions | `components/horizon/PreDraftedActions.tsx` | `GET /api/drafts` (SSE); execute `POST /api/actions` |
| Live signals | `components/horizon/SignalFeed.tsx` | `GET /api/signals` (JSON result from agent) |
| Ask bar | `components/horizon/AskBar.tsx` | `POST /api/ask` (SSE) |
| Client 360 sheet | `components/horizon/ClientDetailSheet.tsx` | `GET /api/client/[id]` (SSE) |
| Section insights | `components/horizon/SectionInsight.tsx` + `InsightsBatchProvider` | `POST /api/insights` (SSE) |

## Scripts (developer)

| Script | Purpose |
|--------|---------|
| `npm run verify:mcp` | Smoke-test all Salesforce MCP servers |
| `npm run smoke:api` | HTTP smoke against configured `APP_URL` |
| `npm run sf:login` | Refresh Salesforce tokens for local scripts |
| `npm run mcp:check` | Quick MCP initialize probe |

## Reference documentation

| Doc | Contents |
|-----|----------|
| [CURSOR_MCP_SETUP.md](./CURSOR_MCP_SETUP.md) | Optional Cursor MCP wiring |
| [SEED_DATA_SPEC.md](./SEED_DATA_SPEC.md) | Data / seed notes for CRM vs Data Cloud |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagrams and flow |
| [OPERATIONS.md](./OPERATIONS.md) | Deploy and runbooks |
