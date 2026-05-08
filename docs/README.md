# `docs/` — Engineering documentation

[![Architecture](https://img.shields.io/badge/start%20here-ARCHITECTURE-blue)](./ARCHITECTURE.md)
[![Operations](https://img.shields.io/badge/deploy-OPERATIONS-430098)](./OPERATIONS.md)
[![Prompts](https://img.shields.io/badge/prompts-LLM__PROMPT__GUIDE-f59e0b)](./LLM_PROMPT_GUIDE.md)
[![Mermaid](https://img.shields.io/badge/diagrams-Mermaid-ff3670)](https://mermaid.js.org/)

The engineering docs for Horizon — what it is, how it's built, how to ship changes, how to keep the agents from hallucinating. Build-spec / product-narrative copy lives elsewhere (root `README.md`, gitignored `CLAUDE.md`); this folder is for **how we operate the codebase**.

## Pick your starting point

| You are… | Read first |
|----------|------------|
| New to the codebase | [`ARCHITECTURE.md`](./ARCHITECTURE.md) — Mermaid diagrams + the agent-loop pattern |
| Shipping a feature | [`ARCHITECTURE.md`](./ARCHITECTURE.md) → [`ARTIFACTS.md`](./ARTIFACTS.md) → [`LLM_PROMPT_GUIDE.md`](./LLM_PROMPT_GUIDE.md) |
| Editing a prompt | [`LLM_PROMPT_GUIDE.md`](./LLM_PROMPT_GUIDE.md) — version-bump rules + recorded failure modes |
| Deploying to Heroku | [`OPERATIONS.md`](./OPERATIONS.md) — release commands, scheduled jobs, secrets, incident triage |
| Debugging the reasoning trail | [`OPERATIONS.md` — triage cheatsheet](./OPERATIONS.md#reasoning-trail-triage-cheatsheet) |
| Wiring Cursor's IDE MCP | [`CURSOR_MCP_SETUP.md`](./CURSOR_MCP_SETUP.md) |
| Touching seed data | [`SEED_DATA_SPEC.md`](./SEED_DATA_SPEC.md) |
| Validating Tier-1/Tier-2 work | [`ASK_MY_DATA_T1_VALIDATION.md`](./ASK_MY_DATA_T1_VALIDATION.md) / [`ANALYZE_T2_VALIDATION.md`](./ANALYZE_T2_VALIDATION.md) |

## Contents

### Core

| Document | What's inside |
|----------|---------------|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | Request-flow diagrams, the three-agent-loop pattern, MCP tool loop details (incl. hallucination-rejection layers + `defaultExc` unwrap), the metadata cache layer with Mermaid (now showing scheduler-credential edges), Salesforce auth + scheduler auth. **Start here.** |
| **[OPERATIONS.md](./OPERATIONS.md)** | Deploy (`git push heroku main`), quality gates, secrets rotation, **scheduled jobs** (with the last-good banker creds resolver), manual cache refresh, **reasoning-trail triage cheatsheet** (rejection patterns + likely fixes). |
| **[ARTIFACTS.md](./ARTIFACTS.md)** | The contract — current prompt versions, every UI surface mapped to its API endpoint, every npm script, every admin/diagnostic route, release-phase migration. |
| **[LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md)** | Where prompts live + how to edit safely, **catalog-first prompt discipline**, **failure-mode catalog** (recorded reasoning-trail patterns + their mitigations) split by agent (Today / Analyze / Ask My Data). |

### Setup + reference

| Document | What's inside |
|----------|---------------|
| [CURSOR_MCP_SETUP.md](./CURSOR_MCP_SETUP.md) | Optional Cursor IDE MCP wiring against Horizon's MCP stack — useful if you're iterating on prompts and want the IDE to call the same MCPs Horizon does. |
| [SEED_DATA_SPEC.md](./SEED_DATA_SPEC.md) | Synthetic data notes (CRM accounts, FSC life events, Data Cloud DMOs). Read before running `npm run seed:dc` or modifying seed scripts. |

### Tier validations (historical)

| Document | What's inside |
|----------|---------------|
| [ASK_MY_DATA_T1_VALIDATION.md](./ASK_MY_DATA_T1_VALIDATION.md) | Closes out v1.1-expansion Tier 1 work for Ask My Data: file mapping, Done-When checklist, post-T1 hardening addenda. |
| [ANALYZE_T2_VALIDATION.md](./ANALYZE_T2_VALIDATION.md) | Closes out v1.1-expansion Tier 2 work for Analyze: agent loop, 18-chart palette, governance drawer, follow-ups, multi-turn, post-T2 hardening addenda. |

## Folder READMEs (linked from each subdirectory)

For per-folder explanations, see the README in each:

- [`app/README.md`](../app/README.md) — Next.js routes, API endpoints, OAuth callback
- [`components/README.md`](../components/README.md) — UI tree by surface (`horizon/`, `analyze/`, `ask-data/`, `nav/`, `brand/`, `ui/`)
- [`lib/client/README.md`](../lib/client/README.md) — client-only hooks + browser utilities
- [`scripts/README.md`](../scripts/README.md) — operational scripts (cache refresh, smoke, seed)
- [`types/README.md`](../types/README.md) — shared TypeScript types

## Recent milestones

- **2026-05-08 — Daily section cache + Tableau scope tightening + SOQL `NOW()` ban.** New server-side per-banker per-local-day cache (`lib/sse/sectionCache.ts`, 36h TTL, Redis-backed) wraps the 5 expensive Today routes (`/api/brief`, `/api/priority`, `/api/pulse`, `/api/drafts`, `/api/arc`): first hit pays the agent loop and persists the captured SSE event sequence, subsequent loads replay synchronously so reasoning trail + inference badge survive. New `makeCacheableSseStream` helper hardens against client tear-down (every `controller.enqueue`/`close` is guarded) and only persists complete narratives (writer not thrown AND controller not canceled AND ≥1 `text_delta` event AND captured.length > 0). `?refresh=1` bypasses the read; `UserMenu.tsx` adds a "Refresh today" entry that fans out all 5 `HORIZON_REFRESH_*` events. Tableau analyze removed from brief / priority / arc prompts — Pulse-only on Today now (saves 10–40s per section, removes upstream timeout risk; the "three first-party Salesforce MCPs" story is preserved through Pulse + Ask Bar). New `SYSTEM_PROMPT_VERSION = v1.6.1` with §B.8 forbidding SQL functions in SOQL (`NOW()`, `CURRENT_TIMESTAMP`, `GETDATE()`, `SYSDATE`); `PULSE_STRIP_PROMPT_VERSION = v1.3.2` removed the `StartDateTime >= NOW()` directive that was causing `MALFORMED_QUERY: unexpected token: NOW`; `preflightSalesforceSoql` now intercepts these before dispatch with an actionable correction. AnalyzeBar wires Web Speech API voice mic (mirrors AskBar / AskDataBar). Live signals are deliberately NOT cached — they continue to poll `/api/signals` every 45s independently.
- **2026-05-07 — Demo-day hardening + UX polish.** Pulse + Drafts now emit verbatim DC SQL against `Financial_Transactions_Snow_XL__dll` with column names quoted from the cached catalog (`amount__c`, `transactiondate__c`, etc.) and a pinned `TIMESTAMP '2024-06-01 00:00:00 UTC'` cutoff (the demo org's transaction stream ends 2026-06-30; relative `CURRENT_DATE` filters returned zero rows). Pulse's Tableau analyze pinned to `Financial_Accounts` SDM with utterance `"Total Current_Balance across Deposits"`. Today-path Tableau timeout 25s → 40s — every Today route streams SSE from first byte so the H12 idle timer doesn't apply, the cap is just a wedged-call backstop. Analyze surface stops replaying the persisted last analysis on every visit (DB write path retained for audit, just no read-back). New `SectionRail` left-edge scroll-spy with connected dots + inline labels for the 5 main column sections, hides itself when a `ClientDetailSheet` is open via `data-horizon-overlay`. ClientDetailSheet now keeps the full 6-tool depth (4 SOQL + 1 DC SQL + 1 Tableau analyze) but caches the final narrative + reasoning trail in `sessionStorage` keyed by clientId — first open ~10s, every reopen during the session is instant. Cleared on sign-out. Section labels bumped to 13px semibold + bright text; Ask Bar input + result panel mixed +6% white via `color-mix(in oklab, …)` so they pop off dark themes. See `lib/client/clientDetailCache.ts` and `components/horizon/SectionRail.tsx`.
- **2026-05-06 (PM) — Scheduler self-heals + SDM apiName preflight + UI chrome.** Headline: scheduler refresh jobs were failing silently because (a) `tsx` was in `devDependencies` so the post-build slug couldn't run them and (b) they required a banker `SF_ACCESS_TOKEN` env var the scheduler can't have. Fixes: `tsx` → `dependencies`, new `scheduler_credentials` singleton table holding the last-good banker `refresh_token`, `scripts/lib/resolveSfToken.ts` resolves a fresh access token at job start (env → config var → DB row). Also: Today-side preflight rejects unknown SDM apiNames (catches Claude inventing names like `Sales_Analytics`), `INVALID_INPUT` / "don't have access" added to breaker patterns, system prompt v1.6.0 forbids owner-user pivots on DC DMOs, Today-path Tableau timeout 20s → 25s, unified `bg-surface` panels across all home-page sections, bold centered section titles on `/`, `/ask`, `/analyze`. See [OPERATIONS.md](./OPERATIONS.md#scheduled-jobs).
- **2026-05-06 (AM) — Agent loop hardening + `defaultExc` unwrap.** Every successful `post_dc_query_sql` was being wrapped in a string-inside-string envelope that the agent couldn't read; the unwrap lives at both MCP wrapper boundaries now. Also: turn-wide `analyze_data` budget on Analyze, synthetic-guard circuit-breaker shield, `<think>`-tag streaming stripper in Ask My Data, visualization-follow-up tool-choice forcing, unified dark/light chart palette, Ask My Data Markdown rendering + preloaded DC catalog + pinned-DMO inclusion list, dev-friendly admin refresh route. See [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) failure-mode catalog.
- **2026-05-01 — Metadata cache layer.** The agent preloads Data Cloud DMO metadata and Tableau semantic models from a Redis cache refreshed by Heroku Scheduler. Discovery tools (`get_dc_metadata`, `list_semantic_models`) are hidden from the model when the cache is warm — the catalog in the system prompt replaces them. See [ARCHITECTURE.md#metadata-cache-layer](./ARCHITECTURE.md#metadata-cache-layer) and [OPERATIONS.md#scheduled-jobs](./OPERATIONS.md#scheduled-jobs).
- **2026-04-30 — Path C.** `data_360` + `tableau_next` moved off the custom self-hosted MCP onto the first-party `/platform/mcp/v1/{data|analytics}/…` endpoints. Next 14 → 15 upgrade + async-boundary migration. Anthropic-direct LLM fallback retired; everything runs on Heroku Inference now.

## Conventions for editing docs

1. **Keep them current.** Each doc has a "Recent milestones" or addendum section — add to it when you ship something with cross-cutting impact.
2. **Mermaid diagrams over ASCII.** GitHub renders Mermaid natively; keep diagrams in fenced blocks.
3. **Triage tables over prose.** When documenting a failure mode, use a `Symptom | Cause | Mitigation` row (see `LLM_PROMPT_GUIDE.md`).
4. **Link sideways.** Every doc should link to the others where relevant — readers arrive from different starting points.
5. **No secrets.** Use placeholders (`SF_CLIENT_ID=…`) and never paste real tokens, even in commit messages or screenshots.
