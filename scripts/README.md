# `scripts/` — Operational + dev tooling

[![tsx](https://img.shields.io/badge/runtime-tsx-3178c6?logo=typescript&logoColor=white)](https://tsx.is/)
[![Heroku Scheduler](https://img.shields.io/badge/scheduler-heroku-430098?logo=heroku&logoColor=white)](https://devcenter.heroku.com/articles/scheduler)
[![Node](https://img.shields.io/badge/node-22.x-43853d?logo=nodedotjs&logoColor=white)](https://nodejs.org/)

Standalone scripts for cache refresh, OAuth login, smoke tests, and local seeding. Most are TypeScript run via `tsx` (with `--env-file-if-exists=.env` so they work both locally and on the Heroku scheduler dyno where env vars are injected natively).

> **Why `tsx` is in `dependencies`, not `devDependencies`:** Heroku's Node buildpack runs `npm prune --omit=dev` after build, before producing the slug. The web dyno doesn't need `tsx` (it serves Next's compiled output) but the scheduler dyno does — and it runs from the same slug. Pinning `tsx` in production deps keeps the scheduler functional.

## Categories

```
scripts/
├── lib/                       Shared script helpers
│   └── resolveSfToken.ts          SF access-token resolver (env → config var → DB row)
├── refresh-dc-metadata.ts     Heroku Scheduler — DC DMO catalog refresh (hourly with skip gate)
├── refresh-tableau-sdms.ts    Heroku Scheduler — Tableau SDM catalog refresh (daily)
├── apply-schema.cjs           Heroku release-phase migration (CJS so it survives prune)
├── verify-mcp.ts              Smoke-test all 3 SF MCPs end-to-end
├── verify-p01.ts              Verification — Phase 01 (Today surfaces)
├── verify-p02.ts              Verification — Phase 02 (Today + Analyze + Ask)
├── smoke-api.ts               HTTP smoke against deployed APP_URL
├── smoke-heroku-inference.ts  Heroku Inference probe — Claude / Kimi / MiniMax round-trip
├── mcp-check.ts               Fast MCP `initialize` probe (no tool calls)
├── mcp-refresh.sh             Wrapper around sf-login that prints Cursor re-source reminders
├── export-mcp-env.sh          Export env vars from the SF login response for shell use
├── sf-login.ts                Local PKCE login → writes `SF_ACCESS_TOKEN` to .env
├── seed-data-cloud.ts         Populate synthetic Data Cloud records (CRM/FSC focus)
├── seed-ask-data.ts           Backdated Ask My Data threads for sidebar grouping demo
└── test-signoff-policy.ts     Internal policy unit test (signoff text rules)
```

## Cache refresh (production critical)

| Script | Trigger | Cadence | Purpose |
|--------|---------|---------|---------|
| `refresh-dc-metadata.ts` | Heroku Scheduler `npm run refresh:dc-metadata` | Hourly cron, real work every ~12h | Rebuilds `dc:metadata:v1:default` Redis key with the projected DMO catalog (~600 surviving DMOs of ~1090 total, ~580KB). Powers the system-prompt catalog block on every Today/Ask My Data turn. |
| `refresh-tableau-sdms.ts` | Heroku Scheduler `npm run refresh:tableau-sdms` | Daily | Rebuilds `tableau:sdms:v1:default` with the banker-relevant SDMs (~8 of ~16 returned), ~40KB. Powers the SDM catalog block + apiName preflight. |

Both call **`scripts/lib/resolveSfToken.ts`** at the start to obtain a fresh access token. Resolution priority:

1. `SF_ACCESS_TOKEN` env var — set by local dev (via `.env`) or by the admin route's child process.
2. `SF_REFRESH_TOKEN` config var — designated service principal for prod-grade rollout.
3. **`scheduler_credentials` Postgres singleton row** — last-good banker login's refresh token. Upserted on every `/callback`. Self-heals: every banker login replaces the row, so as long as someone uses the app within Salesforce's refresh-token revocation window (~90 days idle), the scheduler stays alive.

Both scripts use `redisSetOnce` for the final write — short-lived TLS connection that avoids the "idle socket severed" failure mode on Heroku Mini Redis (20-conn cap).

### Internal skip gate

The DC refresh script fires hourly (Heroku Scheduler's smallest interval) but early-exits 11 of 12 runs via `DC_METADATA_MIN_AGE_HOURS` (default `12`). Force a refresh with `DC_METADATA_FORCE=1`. Tableau equivalent: `TABLEAU_SDM_FORCE=1` + `TABLEAU_SDM_MIN_AGE_HOURS`.

## Release-phase migration

| Script | Trigger | Purpose |
|--------|---------|---------|
| `apply-schema.cjs` | `Procfile`'s `release:` target | Applies `lib/db/schema.sql` to `DATABASE_URL` on every Heroku release. Idempotent (`create table if not exists`). Failure rolls back the slug per Heroku contract — the new release does NOT go live with a missing schema. CJS (not TS) so it works without `tsx`. |

## Smoke tests + diagnostics

| Script | Purpose |
|--------|---------|
| `verify-mcp.ts` | One-call probe of each Salesforce MCP plus the Heroku toolkit MCP. Used as the `npm run verify:mcp` quality gate. |
| `verify-p01.ts`, `verify-p02.ts` | Phase-validation harnesses tied to the v1.1-expansion ship checklists. Live-data — require a fresh SF token. |
| `smoke-api.ts` | HTTP smoke against the deployed `APP_URL` — `/api/health` + a sampling of section endpoints. |
| `smoke-heroku-inference.ts` | OpenAI-compat round-trip against Heroku Inference for each tier (Claude / Kimi / MiniMax). Used when triaging "is the model API itself broken?" |
| `mcp-check.ts` | Fast MCP `initialize` probe — no tool calls, just confirms the connection comes up. |

## Local dev convenience

| Script | Purpose |
|--------|---------|
| `sf-login.ts` | Browser-based PKCE login flow. Prints the resulting `SF_ACCESS_TOKEN` so you can paste into `.env`. |
| `mcp-refresh.sh` | Calls `sf-login` then prints reminders to re-source the env in any open Cursor windows. |
| `export-mcp-env.sh` | Outputs `export SF_ACCESS_TOKEN=…` lines for shell sourcing. |
| `seed-data-cloud.ts` | Populate synthetic CRM/FSC records for demo runs. |
| `seed-ask-data.ts` | Insert backdated Ask My Data threads so the sidebar shows Today / Yesterday / This week / Earlier groups. |

## NPM script ↔ file map

| `npm run …` | File |
|-------------|------|
| `verify:mcp` | `verify-mcp.ts` |
| `verify:p01` / `verify:p02` | `verify-p01.ts` / `verify-p02.ts` |
| `smoke:api` | `smoke-api.ts` |
| `smoke:heroku-inference` | `smoke-heroku-inference.ts` |
| `mcp:check` | `mcp-check.ts` |
| `mcp:refresh` | `mcp-refresh.sh` |
| `sf:login` | `sf-login.ts` |
| `refresh:dc-metadata` | `refresh-dc-metadata.ts` |
| `refresh:tableau-sdms` | `refresh-tableau-sdms.ts` |
| `seed:dc` | `seed-data-cloud.ts` |
| `seed:ask-data` | `seed-ask-data.ts` |
| `test:signoff` | `test-signoff-policy.ts` |

## Conventions

- Every TS script uses `tsx --env-file-if-exists=.env` (not `--env-file`) so it works without a local `.env` (Heroku injects env vars directly).
- Scripts that touch live Salesforce tokens import from `scripts/lib/resolveSfToken.ts` instead of reading `SF_ACCESS_TOKEN` directly — this gets you the env-var → config-var → DB-row resolution chain for free.
- Scripts that write to Redis use `redisSetOnce` for the final write to avoid Mini-tier connection-cap issues during long runs.
- Console output is the primary signal — these scripts run on Heroku where stdout / stderr stream to `heroku logs`. Use clear `[script-name]` prefixes.

## Related

- [`docs/OPERATIONS.md`](../docs/OPERATIONS.md) — scheduled-jobs setup, manual refresh commands, triage cheatsheet.
- [`lib/db/schedulerCreds.ts`](../lib/db/schedulerCreds.ts) — the Postgres helpers behind the credential resolver.
- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — full cache-layer Mermaid including scheduler edges.
