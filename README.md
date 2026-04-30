# Horizon

[CI](https://github.com/josers18/Headless-JDO/actions/workflows/ci.yml)
[Next.js](https://nextjs.org/)
[Node](https://nodejs.org/)
[TypeScript](https://www.typescriptlang.org/)
[License: MIT](./LICENSE)

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


**UI / film polish checklists** (iteration history in repo root): `[UI_V3_FINAL.md](./UI_V3_FINAL.md)`, `[UI_V3_POLISH.md](./UI_V3_POLISH.md)`, `[FIX_PASS.md](./FIX_PASS.md)` — see status banner in `FIX_PASS.md`; authoritative product constraints may also live in a **local** `CLAUDE.md` (listed in `.gitignore` in this clone). **Published** engineering docs live under `**docs/`**.

---

## What it does

- **Morning brief** (life-event hierarchy + “Recent life events”), **priority queue**, **today’s arc**, **portfolio pulse**, **pulse strip**, **pre-drafted actions**, **live signals**, **section insight** banners, **Ask** bar (typed + voice + drafted actions), **Prep me** (per-client briefing via `/api/prep`) — all on `/`.
- The LLM orchestrates three **Salesforce-hosted MCP** servers (CRM SObject, Data 360 SQL, Tableau Next) plus optional **Heroku toolkit** MCP. The UI streams tokens and a collapsible **reasoning trail** of tool calls (success + handled errors).
- **LLM path:** Heroku Managed Inference (Claude 4.5 Sonnet, OpenAI-compatible API) with an MCP tool loop in `lib/llm/heroku.ts`. Optional Kimi-on-Onyx fallback when `HEROKU_INFERENCE_ONYX_*` is configured.
- **Prompt hygiene:** shared rules and version stamps live in `lib/prompts/system.ts` (`SYSTEM_PROMPT_VERSION`). See **[docs/LLM_PROMPT_GUIDE.md](docs/LLM_PROMPT_GUIDE.md)** before changing agent behavior.

---

## Stack


| Layer  | Choice                                                                               |
| ------ | ------------------------------------------------------------------------------------ |
| App    | Next.js 14 (App Router), React 18, TypeScript strict, Tailwind, shadcn-style UI      |
| Deploy | Single Heroku `web` dyno (`Procfile`: `npm start`)                                   |
| Data   | Heroku Postgres (sessions / history), Redis (streaming / TTS cache where configured) |
| Auth   | Salesforce OAuth 2.1 + PKCE (ECA, `mcp_api` scope)                                   |
| Voice  | Web Speech API (TTS / STT); optional ElevenLabs via `/api/tts` when configured       |


---

## Repository layout (short)


| Path                       | Role                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `app/page.tsx`             | Home — primary surface                                                                   |
| `app/api/`*                | SSE / JSON routes: `ask`, `brief`, `priority`, `pulse`, `drafts`, `signals`, OAuth, etc. |
| `lib/llm/heroku.ts`        | Agent loop: model → tool calls → parallel MCP → repeat                                   |
| `lib/mcp/client.ts`        | MCP SDK sessions to Salesforce + optional Heroku toolkit                                 |
| `lib/prompts/*`            | Versioned prompts (`SYSTEM_PROMPT_VERSION` + per-feature `*_PROMPT_VERSION`)             |
| `components/horizon/*`     | UI sections                                                                              |
| `scripts/verify-mcp.ts`    | Smoke test all three Salesforce MCPs                                                     |
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


---

## Environment variables

Copy `[.env.example](./.env.example)` to `.env`. **Do not** paste real keys into issues, PRs, screenshots, or committed markdown. See **[docs/OPERATIONS.md](docs/OPERATIONS.md)** for rotation guidance.


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