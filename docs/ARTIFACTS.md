# Repository artifacts

What ships in this codebase (high level). Prompt versions change over time — bump the constant in the file you edit.

| Constant (export) | File | Current |
|-------------------|------|---------|
| `SYSTEM_PROMPT_VERSION` | `lib/prompts/system.ts` | **v1.6.1-no-now-fn-soql-2026-05-08** |
| `PULSE_STRIP_PROMPT_VERSION` | `lib/prompts/pulse-strip.ts` | **v1.3.2-no-now-fn-2026-05-08** |
| `MORNING_BRIEF_PROMPT_VERSION` | `lib/prompts/morning-brief.ts` | v1.x |
| `PREP_PROMPT_VERSION` | `lib/prompts/prep.ts` | v1.x |
| `ARC_PROMPT_VERSION` | `lib/prompts/arc.ts` | v1.x |
| `ANALYZE_PROMPT_VERSION` | `lib/prompts/analyze.ts` | **v0.5.0** |
| `ASK_DATA_PROMPT_VERSION` | `lib/prompts/ask-data.ts` | **v0.5.0** |
| `ASK_DATA_FOLLOWUPS_PROMPT_VERSION` | `lib/prompts/ask-data-followups.ts` | **v0.3.0** |
| … | Other `lib/prompts/*.ts` | — |

See [**LLM_PROMPT_GUIDE.md**](./LLM_PROMPT_GUIDE.md) for editing rules and a failure-mode catalog.

## User-visible surfaces

| Surface | Client entry | Typical API |
|---------|----------------|-------------|
| Morning brief | `components/horizon/MorningBrief.tsx` | `POST /api/brief` (SSE; daily section cache via `lib/sse/sectionCache.ts` — first hit per banker per local-day pays the agent loop, rest replay; `?refresh=1` bypass) |
| Today’s arc | `components/horizon/TodaysArc.tsx` | `GET /api/arc` (SSE; same daily section cache + `?refresh=1` bypass) |
| Priority queue | `components/horizon/PriorityQueue.tsx` | `GET /api/priority` (SSE; same daily section cache + `?refresh=1` bypass) |
| Portfolio pulse | `components/horizon/PortfolioPulse.tsx` | `GET /api/pulse` (SSE; same daily section cache + `?refresh=1` bypass) |
| Pulse strip (header) | `components/horizon/PulseStrip.tsx` | `GET /api/pulse-strip` (SSE; not cached — light query, runs each load) |
| Pre-drafted actions | `components/horizon/PreDraftedActions.tsx` | `GET /api/drafts` (SSE; same daily section cache + `?refresh=1` bypass); execute `POST /api/actions` |
| Live signals | `components/horizon/SignalFeed.tsx` | `GET /api/signals` (JSON; client polls ~45s) |
| Ask bar | `components/horizon/AskBar.tsx` | `POST /api/ask` (SSE); **Prep me** uses `POST /api/prep` (SSE) from embedded prep flow |
| Client 360 sheet | `components/horizon/ClientDetailSheet.tsx` | `GET /api/client/[id]` (SSE) — first open streams the 6-tool fan-out (4 SOQL + DC SQL + Tableau analyze, ~10s); subsequent opens the same session render synchronously from `sessionStorage` via `lib/client/clientDetailCache.ts`. Cleared on sign-out. |
| Section insights | `components/horizon/SectionInsight.tsx` + `InsightsBatchProvider` | `POST /api/insights` (SSE) |
| **Ask My Data** (`/ask-data`) | `components/ask-data/Conversation.tsx` | `POST /api/ask-data` (SSE); threads via `GET/POST/DELETE /api/ask-threads`; follow-ups via `POST /api/analyze-followups` |
| **Analyze** (`/analyze/[modelId]`) | `components/analyze/AnalyzeWorkbench.tsx` | `POST /api/analyze-ask` (SSE); model list via `GET /api/analyze-models`; follow-ups via `POST /api/analyze-followups` |
| **Token Spend panel** | `components/horizon/TokenSpendPanel.tsx` (fed by `SessionUsageProvider` / `useSessionUsage`) | `GET /api/usage` (JSON) — per-model input/output token subtotals + grand total for the current login session (`hz_sid` cookie). In-flow right-rail on Today (collapsed by default); cross-tab dock on `/ask` + `/analyze`. The Ask Bar also live-bumps it from the `usage_meta` SSE event. |

## Scripts (developer)

| Script | Purpose |
|--------|---------|
| `npm run verify:mcp` | Smoke-test all Salesforce MCP servers |
| `npm run smoke:api` | HTTP smoke against configured `APP_URL` |
| `npm run sf:login` | Refresh Salesforce tokens for local scripts |
| `npm run mcp:check` | Quick MCP initialize probe |
| `npm run mcp:refresh` | Wrapper around `sf:login` that also prints Cursor re-source reminders |
| `npm run refresh:dc-metadata` | Scheduled job — rebuilds the DC DMO catalog cache in Redis. Resolves SF token via `SF_ACCESS_TOKEN` env / `SF_REFRESH_TOKEN` config / `scheduler_credentials` row (`scripts/lib/resolveSfToken.ts`). See [OPERATIONS.md](./OPERATIONS.md#scheduled-jobs). |
| `npm run refresh:tableau-sdms` | Scheduled job — rebuilds the Tableau Next SDM catalog cache in Redis. Same token-resolution path. |
| `npm run seed:dc` | Populate synthetic Data Cloud seed records |
| `npm run seed:ask-data` | Seed the Ask My Data thread + sample records |
| `npm run smoke:heroku-inference` | Smoke-test the Heroku Managed Inference endpoint directly |
| `npm run verify:p01` / `npm run verify:p02` | Phase-specific verification probes |
| `npm run test:signoff` | Regression — sign-off policy logic (`scripts/test-signoff-policy.ts`) |
| `npm run test:trail` | Regression — reasoning-trail turn-header grouping/ordering (`scripts/test-reasoning-trail-grouping.ts`) |
| `npm run test:analyze-budget` | Regression — `analyze_data` once-budget not-found gate, the CSAT fix (`scripts/test-analyze-budget-notfound.ts`) |

**Note:** all `tsx`-driven npm scripts now use `--env-file-if-exists=.env` so they work both with a local `.env` and on Heroku where env vars are injected natively. `tsx` itself moved to `dependencies` (was `devDependencies`) so post-build slugs include it for scheduler dynos.

## Release phase

`Procfile`'s `release:` target runs `node scripts/apply-schema.cjs` on every Heroku release. That CJS script applies `lib/db/schema.sql` to `DATABASE_URL` (idempotent — every CREATE uses `if not exists`). Failure rolls back the release per Heroku contract; the new slug never goes live with a missing schema.

## Admin / diagnostic endpoints

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/health` | GET | Liveness probe — used by Heroku + smoke tests |
| `/api/usage` | GET | Session token-spend summary (JSON) — sums `token_usage` rows for the current `hz_sid` session, grouped by model. Read-only; feeds the Token Spend panel. |
| `/api/admin/refresh-dc-cache` | GET | Diagnostic: returns current DC cache freshness (`generatedAt`, `ageHours`, `survivingDmos`, top 10 DMOs by row count) **and** Tableau SDM slice (`tableau.cached`, `tableau.survivingSdms`, `tableau.apiNames` — full list of valid SDM apiNames). Use when triaging hallucinated SDM rejections. |
| `/api/admin/refresh-dc-cache?run=1&tool=dc\|tableau\|both&force=1` | GET or POST | Dev trigger: spawns the refresh script as a child process using the banker's live session token. Auth-required (reads the session cookie to mint `SF_ACCESS_TOKEN`). |

## Reference documentation

| Doc | Contents |
|-----|----------|
| [CURSOR_MCP_SETUP.md](./CURSOR_MCP_SETUP.md) | Optional Cursor MCP wiring |
| [SEED_DATA_SPEC.md](./SEED_DATA_SPEC.md) | Data / seed notes for CRM vs Data Cloud |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Diagrams and flow |
| [OPERATIONS.md](./OPERATIONS.md) | Deploy and runbooks |
| [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) | Prompts and agent hygiene |
