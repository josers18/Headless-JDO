# Horizon

[![CI](https://github.com/josers18/Headless-JDO/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/josers18/Headless-JDO/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Node](https://img.shields.io/badge/node-22.x-43853d?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Deployed on Heroku](https://img.shields.io/badge/Heroku-deployed-430098?logo=heroku&logoColor=white)](https://headless-jdo-002d2a119b15.herokuapp.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

**Headless home page for the relationship banker** — one scrollable surface, no nav rails, MCP-backed agent. Built for the Salesforce / DAX *So You Think You Can AI?* Innovation Contest track (2026).

**Production (reference deploy):** [Horizon on Heroku](https://headless-jdo-002d2a119b15.herokuapp.com/) (`headless-jdo`)

---

## Documentation


| Doc                                                      | Purpose                                                |
| -------------------------------------------------------- | ------------------------------------------------------ |
| **[docs/README.md](docs/README.md)**                     | Documentation index                                    |
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**         | Diagrams (Mermaid), MCP flow, key paths                |
| **[docs/OPERATIONS.md](docs/OPERATIONS.md)**             | Deploy, env, incidents, secrets rotation               |
| **[docs/ARTIFACTS.md](docs/ARTIFACTS.md)**               | UI ↔ API map, npm scripts                              |
| **[docs/LLM_PROMPT_GUIDE.md](docs/LLM_PROMPT_GUIDE.md)** | Prompt files, version bumps, reasoning-trail learnings |
| **[docs/CURSOR_MCP_SETUP.md](docs/CURSOR_MCP_SETUP.md)** | Optional Cursor MCP wiring                             |
| **[docs/SEED_DATA_SPEC.md](docs/SEED_DATA_SPEC.md)**     | CRM / FSC seed notes                                   |
| **[CONTRIBUTING.md](CONTRIBUTING.md)**                   | Quality gates and contribution norms                   |


**UI / film polish checklists** (iteration history in repo root): [UI_V3_FINAL.md](./UI_V3_FINAL.md), [UI_V3_POLISH.md](./UI_V3_POLISH.md), [FIX_PASS.md](./FIX_PASS.md) — see status banner in `FIX_PASS.md`; authoritative product constraints may also live in a **local** `CLAUDE.md` (listed in `.gitignore` in this clone). **Published** engineering docs live under `docs/`.

---

## What it does

- **Home (Today)** (`/`) — **Morning brief** (life-event hierarchy + "Recent life events"), **priority queue**, **today's arc**, **portfolio pulse**, **pulse strip**, **pre-drafted actions**, **live signals**, **section insight** banners, **Ask** bar (typed + voice + drafted actions), **Prep me** (per-client briefing via `/api/prep`), **left-edge section rail** (scroll-spy with click-to-jump at xl+), **session-cached Client 360° sheet** (first open ~10s for full depth, every reopen instant during the session), **daily section snapshot cache** for the 5 expensive routes (`/api/{brief,priority,pulse,drafts,arc}`) keyed by banker × local-day — first load pays the agent cost, every subsequent load that day replays the captured SSE event sequence. **Refresh today** in the user menu bypasses the cache.
- **Ask My Data** (`/ask-data`) — multi-turn exploratory SQL agent over Data Cloud. Markdown-rendered responses, persisted thread history, reasoning trail, follow-up pill suggestions.
- **Analyze** (`/analyze/[modelId]`) — governed analytics workbench over Tableau Next SDMs. 18 chart types with grounded MiniMax chart selection, per-model starter questions, multi-turn in-memory conversation, clickable metric chips, Business Preferences panel.
- The LLM orchestrates three **Salesforce-hosted MCP** servers (CRM SObject, Data 360 SQL, Tableau Next) plus optional **Heroku toolkit** MCP. The UI streams tokens and a collapsible **reasoning trail** of tool calls (success + handled errors).
- **LLM path:** Heroku Managed Inference (Claude 4.5 Sonnet for Today, Kimi K2 Thinking for Analyze + Ask My Data, MiniMax M2 for chart/followup tier). All via OpenAI-compatible `/v1/chat/completions`.
- **Agent hardening:** turn-wide dedup cache, per-tool circuit breakers with synthetic-guard shielding, `<think>`-tag streaming stripper, tool-choice forcing on visualization follow-ups, `defaultExc` envelope unwrap at MCP wrapper boundary, **runtime preflight that rejects hallucinated DC tables/columns and Tableau SDM apiNames** before they hit the network — all in `lib/inference/{analyzeAgent,askDataAgent}.ts` + `lib/llm/heroku.ts` + `lib/mcp/{client,firstPartyDataCloud}.ts`.
- **Prompt hygiene:** shared rules and version stamps live in `lib/prompts/system.ts` + per-feature prompt files (`*_PROMPT_VERSION`). See **[docs/LLM_PROMPT_GUIDE.md](docs/LLM_PROMPT_GUIDE.md)** before changing agent behavior.
- **Unattended cache refresh:** Heroku Scheduler jobs use a "last-good banker" credential pattern — every banker login upserts their `refresh_token` into a Postgres singleton row, scheduler scripts exchange it for a fresh access token at job start (`scripts/lib/resolveSfToken.ts`). Self-heals on each new login. See [docs/OPERATIONS.md](docs/OPERATIONS.md#scheduled-jobs).

---

## Stack


| Layer  | Choice                                                                               |
| ------ | ------------------------------------------------------------------------------------ |
| App    | Next.js 15 (App Router), React 18, TypeScript strict, Tailwind, shadcn-style UI      |
| Deploy | Heroku `web` dyno (`Procfile`: `npm start`) + `release` phase that applies `lib/db/schema.sql` |
| Data   | Heroku Postgres (sessions, briefings, threads, **scheduler_credentials**), Redis (streaming, TTS cache, **DMO + SDM catalog caches** refreshed by Heroku Scheduler) |
| Auth   | Salesforce OAuth 2.1 + PKCE (ECA, `mcp_api` + `cdp_api` + `refresh_token` scopes)    |
| Voice  | Web Speech API (TTS / STT); optional ElevenLabs via `/api/tts` when configured       |


---

## Repository layout (short)


| Path                       | Role                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `app/(banker)/page.tsx`    | Home — primary surface (Today)                                                            |
| `app/(banker)/{ask,analyze}/`     | Ask My Data + Analyze surfaces (banker route group)                                |
| `app/api/`*                | SSE / JSON routes: `ask`, `brief`, `priority`, `pulse`, `drafts`, `signals`, OAuth, etc. |
| `app/api/admin/refresh-dc-cache/` | Diagnostic GET + trigger POST — returns DC + Tableau SDM cache freshness, or with `?run=1&tool=dc\|tableau\|both&force=1` spawns the refresh script using the banker's live session token |
| `app/api/analyze-ask/`, `app/api/ask-data/` | SSE agent routes for Analyze + Ask My Data (separate loops in `lib/inference/`) |
| `app/callback/route.ts`    | OAuth return leg — also upserts `scheduler_credentials` row for unattended refreshes      |
| `lib/llm/heroku.ts`        | Today agent loop: model → tool calls → parallel MCP → repeat; tool-filter + hallucination-reject + DC/SDM preflight |
| `lib/llm/provider.ts`      | `runAgentWithMcp` wrapper — loads both caches, injects catalogs + apiName allowlist        |
| `lib/llm/dcMetadataCache.ts` | Reads DC DMO catalog from Redis, renders system-prompt block                           |
| `lib/llm/tableauSemanticCache.ts` | Reads Tableau SDM catalog from Redis, renders system-prompt block                 |
| `lib/mcp/client.ts`        | MCP SDK sessions to Salesforce + optional Heroku toolkit; per-tool timeouts              |
| `lib/db/schedulerCreds.ts` | Singleton `scheduler_credentials` row helpers (last-good banker refresh token)            |
| `lib/prompts/*`            | Versioned prompts (`SYSTEM_PROMPT_VERSION` + per-feature `*_PROMPT_VERSION`)             |
| `components/horizon/*`     | Today UI sections                                                                         |
| `components/{analyze,ask-data}/*` | Analyze + Ask My Data UI                                                          |
| `components/nav/SectionTopBar.tsx` | Centered bold title chrome shared across `/`, `/ask`, `/analyze`                 |
| `scripts/verify-mcp.ts`    | Smoke test all three Salesforce MCPs                                                     |
| `scripts/lib/resolveSfToken.ts` | Token resolver for refresh scripts: env var → config var → `scheduler_credentials` row |
| `scripts/refresh-dc-metadata.ts` | Heroku-Scheduler job — rebuilds DC DMO catalog into Redis every 12h (hourly with internal skip gate) |
| `scripts/refresh-tableau-sdms.ts` | Heroku-Scheduler job — rebuilds Tableau SDM catalog into Redis daily               |
| `scripts/apply-schema.cjs` | Heroku release-phase migration runner (idempotent `lib/db/schema.sql` apply)              |
| `.github/workflows/ci.yml` | Lint, typecheck, build on `main` / PRs                                                   |


---

## Quickstart (local)

```bash
npm install
cp .env.example .env
# Edit .env — never commit .env

# Optional: apply DB schema when using Postgres features locally
# psql "$DATABASE_URL" -f lib/db/schema.sql

npm run verify:mcp    # expects SF token + inference vars in .env
npm run dev           # http://localhost:3000
```

Sign in via Salesforce from the app; the callback URL must match your External Client App (e.g. `http://localhost:3000/callback`).

---

## NPM scripts


| Script                               | Purpose                                  |
| ------------------------------------ | ---------------------------------------- |
| `npm run dev`                        | Next.js dev server                       |
| `npm run build` / `npm start`        | Production build / start (Heroku)        |
| `npm run lint` / `npm run typecheck` | Quality gates                            |
| `npm run verify:mcp`                 | End-to-end MCP smoke test                |
| `npm run sf:login`                   | PKCE login; refreshes tokens for scripts |
| `npm run smoke:api`                  | Hit deployed API health / smoke paths    |
| `npm run mcp:check`                  | Fast MCP `initialize` probe              |
| `npm run refresh:dc-metadata`        | Rebuild DC DMO catalog cache in Redis (Heroku Scheduler job). In dev, prefer `GET /api/admin/refresh-dc-cache?run=1&force=1` from an authenticated browser tab — no `SF_ACCESS_TOKEN` plumbing needed. |
| `npm run refresh:tableau-sdms`       | Rebuild Tableau Next SDM catalog cache in Redis (Heroku Scheduler job). Dev path: `?run=1&tool=tableau&force=1` on the admin route. |


---

## Environment variables

Copy [`.env.example`](./.env.example) to `.env`. **Do not** paste real keys into issues, PRs, screenshots, or committed markdown. See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for rotation guidance.


| Area             | Variables (names only)                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| LLM (Heroku)     | `INFERENCE_URL`, `INFERENCE_KEY`, `INFERENCE_MODEL_ID`                  |
| LLM (Kimi fallback, optional) | `HEROKU_INFERENCE_ONYX_URL`, `HEROKU_INFERENCE_ONYX_KEY`, `HEROKU_INFERENCE_ONYX_MODEL_ID` |
| Salesforce OAuth | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL`, `SF_REDIRECT_URI`   |
| App URLs         | `APP_URL` — must match the public origin (critical on Heroku for OAuth) |
| Demo / brief     | `DEMO_BANKER_USER_ID`, `DEMO_BANKER_NAME`, optional `DEMO_BANKER_TZ`    |
| Data             | `DATABASE_URL`, `REDIS_URL`                                             |
| TTS (optional)   | `ELEVENLABS_`*, see `.env.example`                                      |


---

## Deploy

### Heroku (application release)

```bash
heroku git:remote -a headless-jdo   # once; use your app name if different
git push heroku main
```

Set Heroku config vars to match production URLs (`APP_URL`, `SF_REDIRECT_URI` including `https://…/callback`).

### GitHub (source control)

```bash
git push origin main
```

`origin` does **not** deploy the Heroku app unless you add automation; releases are typically `**git push heroku main`**. See **[docs/OPERATIONS.md](docs/OPERATIONS.md)**.

---

## Security & secrets hygiene

- `**.env` is gitignored** — keep it local / platform-only.
- **Never commit** API keys, refresh tokens, client secrets, or inference keys.
- `.cursor/mcp.json` in-repo uses `${env:…}` placeholders only where applicable.

---

## License

[MIT](./LICENSE)