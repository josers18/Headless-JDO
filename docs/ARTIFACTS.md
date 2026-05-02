# Repository artifacts

What ships in this codebase (high level). Prompt versions change over time — bump the constant in the file you edit.

| Constant (export) | File |
|-------------------|------|
| `SYSTEM_PROMPT_VERSION` | `lib/prompts/system.ts` |
| `MORNING_BRIEF_PROMPT_VERSION` | `lib/prompts/morning-brief.ts` |
| `PREP_PROMPT_VERSION` | `lib/prompts/prep.ts` |
| `ARC_PROMPT_VERSION` | `lib/prompts/arc.ts` |
| … | Other `lib/prompts/*.ts` |

See [**LLM_PROMPT_GUIDE.md**](./LLM_PROMPT_GUIDE.md) for editing rules and a failure-mode catalog.

## User-visible surfaces

| Surface | Client entry | Typical API |
|---------|----------------|-------------|
| Morning brief | `components/horizon/MorningBrief.tsx` | `POST /api/brief` (SSE) |
| Today’s arc | `components/horizon/TodaysArc.tsx` | `GET /api/arc` (SSE) |
| Priority queue | `components/horizon/PriorityQueue.tsx` | `GET /api/priority` (SSE) |
| Portfolio pulse | `components/horizon/PortfolioPulse.tsx` | `GET /api/pulse` (SSE) |
| Pulse strip (header) | `components/horizon/PulseStrip.tsx` | `GET /api/pulse-strip` (SSE) |
| Pre-drafted actions | `components/horizon/PreDraftedActions.tsx` | `GET /api/drafts` (SSE); execute `POST /api/actions` |
| Live signals | `components/horizon/SignalFeed.tsx` | `GET /api/signals` (JSON; client polls ~45s) |
| Ask bar | `components/horizon/AskBar.tsx` | `POST /api/ask` (SSE); **Prep me** uses `POST /api/prep` (SSE) from embedded prep flow |
| Client 360 sheet | `components/horizon/ClientDetailSheet.tsx` | `GET /api/client/[id]` (SSE) |
| Section insights | `components/horizon/SectionInsight.tsx` + `InsightsBatchProvider` | `POST /api/insights` (SSE) |

## Scripts (developer)

| Script | Purpose |
|--------|---------|
| `npm run verify:mcp` | Smoke-test all Salesforce MCP servers |
| `npm run smoke:api` | HTTP smoke against configured `APP_URL` |
| `npm run sf:login` | Refresh Salesforce tokens for local scripts |
| `npm run mcp:check` | Quick MCP initialize probe |
| `npm run mcp:refresh` | Wrapper around `sf:login` that also prints Cursor re-source reminders |
| `npm run refresh:dc-metadata` | Scheduled job — rebuilds the DC DMO catalog cache in Redis (see [OPERATIONS.md](./OPERATIONS.md#scheduled-jobs)) |
| `npm run refresh:tableau-sdms` | Scheduled job — rebuilds the Tableau Next SDM catalog cache in Redis |
| `npm run seed:dc` | Populate synthetic Data Cloud seed records |

## Admin / diagnostic endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Liveness probe — used by Heroku + smoke tests |
| `/api/admin/refresh-dc-cache` | GET | Returns current DC metadata cache freshness, surviving DMO count, and top 10 DMOs by row count. Does NOT trigger a refresh — that runs out-of-band via the scheduler. |

## Reference documentation

| Doc | Contents |
|-----|----------|
| [CURSOR_MCP_SETUP.md](./CURSOR_MCP_SETUP.md) | Optional Cursor MCP wiring |
| [SEED_DATA_SPEC.md](./SEED_DATA_SPEC.md) | Data / seed notes for CRM vs Data Cloud |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagrams and flow |
| [OPERATIONS.md](./OPERATIONS.md) | Deploy and runbooks |
| [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) | Prompts and agent hygiene |
