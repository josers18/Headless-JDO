# Horizon

Headless home page for the relationship banker: one surface, no nav rails, agent-first. Built for the DAX *So You Think You Can AI?* Innovation Contest (April 2026).

**Internal docs (local only, not in git):** keep `CLAUDE.md` and `FIX_PASS.md` in your clone root for the full build spec, MCP hygiene, design tokens, demo checklist, and prioritized defect list. They are **gitignored** so they are not pushed to GitHub or included in Heroku deploy commits from this workflow — copy them from your secure backup or maintain them only on your machine.

---

## What it does

- **Morning brief**, **priority queue**, **portfolio pulse**, **pre-drafted actions**, **live signals**, and a fixed **Ask** bar — all on `/`.
- The LLM orchestrates three **Salesforce-hosted MCP** servers (CRM SObject, Data 360 SQL, Tableau Next). The UI streams tokens and a collapsible **reasoning trail** of tool calls.
- **Default LLM path:** Heroku Managed Inference (Claude 4.5 Sonnet, OpenAI-compatible API) with our own MCP tool loop in `lib/llm/heroku.ts`. **Optional fallback:** `LLM_PROVIDER=anthropic` (native `mcp_servers` on Anthropic).

---

## Stack

| Layer | Choice |
|--------|--------|
| App | Next.js 14 (App Router), React 18, TypeScript strict, Tailwind, shadcn-style UI |
| Deploy | Single Heroku `web` dyno (`Procfile`: `npm start`) |
| Data | Heroku Postgres (sessions / history), Redis (streaming signals where used) |
| Auth | Salesforce OAuth 2.1 + PKCE (ECA, `mcp_api` scope) |
| Voice | Web Speech API (TTS / STT); optional pre-rendered TTS (e.g. ElevenLabs + cache) per your local defect backlog |

---

## Repository layout (short)

| Path | Role |
|------|------|
| `app/page.tsx` | Home — the whole app |
| `app/api/*` | SSE-backed routes: `ask`, `brief`, `priority`, `pulse`, `drafts`, `signals`, Salesforce OAuth |
| `lib/llm/heroku.ts` | Agent loop: model → tool calls → parallel MCP → repeat |
| `lib/mcp/client.ts` | MCP SDK sessions to Salesforce + optional Heroku toolkit |
| `lib/prompts/*` | Versioned prompts (treat as code) |
| `components/horizon/*` | UI sections |
| `scripts/verify-mcp.ts` | Smoke test all three Salesforce MCPs |
| `docs/CURSOR_MCP_SETUP.md` | Optional: wire the same MCPs into Cursor for schema grounding |
| `docs/SEED_DATA_SPEC.md` | Data / seeding notes for CRM vs Data Cloud |

---

## Quickstart (local)

```bash
npm install
cp .env.example .env
# Edit .env: see “Environment variables” below. Never commit .env.

# Optional: apply DB schema when using Postgres features locally
# psql "$DATABASE_URL" -f lib/db/schema.sql

npm run verify:mcp    # expects SF token + inference vars in .env
npm run dev           # http://localhost:3000
```

Sign in via Salesforce from the app; callback URL must match your ECA (e.g. `http://localhost:3000/callback` for local dev).

---

## NPM scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / start (Heroku uses these) |
| `npm run lint` / `npm run typecheck` | Quality gates |
| `npm run verify:mcp` | End-to-end MCP smoke test |
| `npm run sf:login` | PKCE login; refreshes tokens in `.env` for scripts |
| `npm run smoke:api` | Hit deployed API health / smoke paths |
| `npm run mcp:check` | Fast probe: userinfo + MCP `initialize` for all three servers |
| `npm run mcp:refresh` | `sf:login` → export env for Cursor MCP → `mcp:check` |

---

## Environment variables

Copy [`.env.example`](./.env.example) to `.env` and fill values locally or in Heroku config. **Do not paste real keys into issues, PRs, screenshots, or committed markdown.**

| Area | Variables (names only) |
|------|---------------------------|
| LLM (Heroku) | `LLM_PROVIDER`, `INFERENCE_URL`, `INFERENCE_KEY`, `INFERENCE_MODEL_ID` |
| LLM (fallback) | `ANTHROPIC_API_KEY` when `LLM_PROVIDER=anthropic` |
| Salesforce OAuth | `SF_CLIENT_ID`, `SF_CLIENT_SECRET`, `SF_LOGIN_URL`, `SF_REDIRECT_URI` |
| App URLs | `APP_URL` — must match the public origin behind the proxy (important on Heroku for OAuth redirects) |
| Demo / brief context | `DEMO_BANKER_USER_ID`, `DEMO_BANKER_NAME`, optional `DEMO_BANKER_TZ` (IANA zone for server-side brief time; header clock uses the browser) |
| Data | `DATABASE_URL`, `REDIS_URL` |
| Narration (optional) | `ELEVENLABS_API_KEY` (trimmed — no stray newlines), optional `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL_ID` (code default **`eleven_flash_v2_5`**; override if your plan only exposes other models — the server retries **`eleven_multilingual_v2`** and `mp3_22050_32` automatically), `ELEVENLABS_OUTPUT_FORMAT`, optional `ELEVENLABS_API_BASE`. `POST /api/tts` returns MP3 (Redis when `REDIS_URL` is set). Fallback JSON includes **`detail`**. `TTS_REQUIRE_SF_AUTH=0` is a temporary demo escape if the SF cookie does not hit `/api/tts` |
| Script-only SF token | Optional `SF_ACCESS_TOKEN`, `SF_INSTANCE_URL` after `npm run sf:login` |

If any credential was ever exposed in chat or a public repo, **rotate it** in Salesforce, Heroku, and Anthropic — the repo and docs intentionally contain **no** real tokens.

---

## Deploy (Heroku)

This repo is the app root. Typical flow:

```bash
heroku git:remote -a headless-jdo   # once
git push heroku main                # build + release
```

Set config vars on the app to match production URLs (`APP_URL`, `SF_REDIRECT_URI` including `https://…/callback`). GitHub remote (`origin`) is for source control; `heroku` is for releases.

---

## Security & secrets hygiene

- **`.env` is gitignored** — it must stay local / Heroku-only.
- **`.cursor/mcp.json`** in this repo uses `${env:…}` placeholders only; real tokens live in the environment, not in JSON committed to Git.
- **Never commit** API keys, refresh tokens, client secrets, or inference keys. If you add docs or examples, use placeholders like `sk-ant-…` or empty `INFERENCE_KEY=`.
- Run `git grep -iE 'sk-ant-|inf-[a-f0-9-]{8,}|client_secret\\s*=' -- '*.md' '*.ts' '*.tsx' '*.json'` before pushing if you are unsure.

---

## License

No license file is checked in yet. Add one (e.g. MIT or your org’s standard) if you need explicit redistribution terms.
