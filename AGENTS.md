# AGENTS.md — Horizon Setup Guide

> **What this is.** A self-contained recipe for spinning up Horizon in your own Salesforce org and Heroku account. Hand this file to any AI coding agent (Claude Code, Cursor, Codex, Gemini CLI, Aider, Continue) and it should be able to walk you through the full setup interactively — prompting you for every value it needs, creating the External Client App, provisioning Heroku add-ons, populating env vars, and verifying the deploy.
>
> **What Horizon is.** A Next.js 15 + React 18 application that gives a relationship banker a single conversational home page powered by Claude (and optionally Kimi + MiniMax) via Heroku Managed Inference, orchestrating three first-party Salesforce MCP servers (CRM, Data 360, Tableau Next). No nav, no tabs — the conversation is the interface.

---

## 0. Instructions to the Agent Reading This File

You are setting up Horizon for a new user in their environment. Follow this guide top-to-bottom. **Stop and ask the user for every value listed in §3.1.** Do not invent or assume values. If a step requires a screen action the user must take in the Salesforce or Heroku UI, walk them through it explicitly and wait for confirmation before proceeding.

Approximate phases:

1. **Verify prerequisites** (§1) — Node, Heroku CLI, org access.
2. **Collect configuration values** (§3.1) — ask the user for everything you'll need. Do this once, up front, so the rest is mechanical.
3. **Create the Salesforce External Client App** (§2) — guide the user through the org UI; capture client ID + secret.
4. **Provision Heroku** (§4) — create app, add buildpack, install add-ons, configure scheduler.
5. **Set environment variables** (§3) — populate `.env` locally and Heroku config in parallel.
6. **First local smoke** (§5) — verify MCP connectivity before deploying.
7. **First deploy** (§6) — push to Heroku, watch release-phase migration, verify health.
8. **Post-deploy smoke** (§7) — run the verification checklist.

If any step fails, consult §8 (Troubleshooting) and report the symptom + the failing log line back to the user before guessing a fix.

---

## 1. Prerequisites

The user must have these installed/available *before* you start. Verify each.

| Requirement | How to check | Notes |
|---|---|---|
| Node.js **22.x** | `node --version` → `v22.*` | Heroku build will fail on other majors. |
| npm 10+ | `npm --version` | Bundled with Node 22. |
| Git | `git --version` | Standard. |
| Heroku CLI | `heroku --version` | Required for app creation, config, logs. |
| Heroku account | `heroku auth:whoami` | Must be logged in. |
| Salesforce org | User confirms | Org must have **Data Cloud** and **Tableau Next** provisioned, and the user must have permission to create an **External Client App** (System Administrator profile or equivalent). |
| Heroku Managed Inference access | User confirms | The `heroku-inference` add-on may be in private beta in the user's region. Confirm availability before proceeding. |

If any prerequisite is missing, stop and instruct the user to install/provision it before continuing.

---

## 2. Salesforce External Client App (ECA)

Horizon authenticates the end user via **OAuth 2.1 + PKCE** against an ECA — *not* a classic Connected App. ECAs ship the MCP scopes; classic Connected Apps do not.

Walk the user through this in their Salesforce org:

1. **Setup → External Client App Manager → New External Client App.**
2. **Basic Information**
   - Name: anything they want (e.g. `Horizon Local`).
   - Contact email: their address.
3. **API (Enable OAuth Settings)** — toggle on. Then:
   - **Enable OAuth 2.1**: ✅ (default on new ECAs).
   - **Require Proof Key for Code Exchange (PKCE)**: ✅
   - **Callback URL** — add **both** of these on separate lines:
     - `http://localhost:3000/callback`
     - `https://<heroku-app-name>.herokuapp.com/callback` *(use the value the user gives you in §3.1; if they haven't picked an app name yet, decide it now and lock it in)*
   - **Selected OAuth Scopes** — add **exactly these three, no more**:
     - `Access Salesforce hosted MCP servers (mcp_api)`
     - `Access all Data Cloud API resources (cdp_api)`
     - `Perform requests at any time (refresh_token, offline_access)`

   ⚠️ Do not add additional scopes. ECAs reject longer scope strings at runtime with `OAUTH_CODE_CRED_SCOPE_TOO_LONG`.

4. **Save**, then open the app's detail page and copy:
   - **Consumer Key** → this is the value for `SF_CLIENT_ID`.
   - **Consumer Secret** (click "Click to reveal") → `SF_CLIENT_SECRET`.

5. **Policies tab** (if present in the org) → set **Refresh Token Policy** to "Refresh token is valid until revoked." Set **IP Relaxation** to "Relax IP restrictions" for dev convenience (tighten in production).

Capture the Consumer Key + Secret in your collected values (§3.1).

---

## 3. Configuration Values

### 3.1 Ask the User for These

Prompt the user for each value. Group the questions logically; don't ask 25 at once. The agent should populate both `.env` (locally) and Heroku config vars from the same answers.

**Identity / app naming**

| Variable | Prompt | Example |
|---|---|---|
| `<HEROKU_APP_NAME>` | What do you want to name your Heroku app? (lowercase, hyphens, must be globally unique) | `my-horizon-prod` |
| `APP_URL` | Public origin of your deployed app | `https://my-horizon-prod.herokuapp.com` |

**Salesforce OAuth (from §2)**

| Variable | Prompt |
|---|---|
| `SF_CLIENT_ID` | Consumer Key from your ECA |
| `SF_CLIENT_SECRET` | Consumer Secret from your ECA |
| `SF_LOGIN_URL` | `https://login.salesforce.com` for production orgs; `https://<your-domain>.my.salesforce.com` for sandboxes / scratch orgs / demo orgs |
| `SF_REDIRECT_URI` | For local dev: `http://localhost:3000/callback`. For Heroku config: `https://<HEROKU_APP_NAME>.herokuapp.com/callback`. **Must match exactly an entry in the ECA Callback URL list.** |

**Heroku Managed Inference**

The primary stack (`INFERENCE_*`) is **auto-populated** by the `heroku-inference` add-on once installed (§4). The user does not need to provide these manually. The Kimi and MiniMax stacks (`HEROKU_INFERENCE_ONYX_*`, `HEROKU_INFERENCE_IVORY_*`) currently share the same endpoint and key as the primary stack; only the model ID changes. Ask the user:

| Variable | Prompt | Default |
|---|---|---|
| `INFERENCE_MODEL_ID` | Which Claude model? | `claude-4-5-sonnet` |
| `HEROKU_INFERENCE_ONYX_MODEL_ID` | Reasoning-tier model (used by Ask My Data + Analyze). Leave default unless they have a reason. | `kimi-k2-thinking` |
| `HEROKU_INFERENCE_IVORY_MODEL_ID` | Short-form tier (titles, suggestions, chart selection) | `minimax-m2` |

If the user does not need Ask My Data or Analyze (they only want the Today home page), the Onyx and Ivory stacks are optional — the Today path uses only the primary `INFERENCE_*` vars.

**Demo persona**

| Variable | Prompt | Example |
|---|---|---|
| `DEMO_BANKER_USER_ID` | Salesforce User ID (18-char) of the banker persona this demo represents | `0058x000001abcdAAA` |
| `DEMO_BANKER_NAME` | Display name | `Casey Reynolds` |
| `DEMO_BANKER_TZ` | Optional. IANA timezone for server-side prompt context | `America/New_York` (default) |

**Optional: ElevenLabs TTS**

If the user wants premium voice output instead of the browser's Web Speech API:

| Variable | Prompt |
|---|---|
| `ELEVENLABS_API_KEY` | API key from elevenlabs.io |
| `ELEVENLABS_VOICE_ID` | Voice ID (default `21m00Tcm4TlvDq8ikWAM`) |
| `ELEVENLABS_MODEL_ID` | Default `eleven_flash_v2_5` |
| `ELEVENLABS_OUTPUT_FORMAT` | Default `mp3_44100_128` |

If they don't supply ElevenLabs keys, leave these unset — the app falls back to Web Speech API automatically.

### 3.2 Auto-populated by Heroku

The user does **not** supply these — Heroku add-ons set them on installation:

- `INFERENCE_URL`, `INFERENCE_KEY` (from `heroku-inference`)
- `HEROKU_INFERENCE_ONYX_URL`, `HEROKU_INFERENCE_ONYX_KEY` (same endpoint/key as primary; copy from `INFERENCE_*` after the add-on installs)
- `HEROKU_INFERENCE_IVORY_URL`, `HEROKU_INFERENCE_IVORY_KEY` (same)
- `DATABASE_URL` (from `heroku-postgresql`)
- `REDIS_URL` (from `heroku-redis`)

### 3.3 Local-only

Used only by smoke-test scripts on the user's laptop; **never set in Heroku config**:

- `SF_ACCESS_TOKEN`, `SF_INSTANCE_URL` — captured by `npm run sf:login` (§5).

---

## 4. Heroku Provisioning

Run these as the user (or instruct them to run them):

```bash
# Create the app
heroku create <HEROKU_APP_NAME>

# Pin the Node buildpack
heroku buildpacks:set heroku/nodejs --app <HEROKU_APP_NAME>

# Database — release phase will auto-apply schema on first deploy
heroku addons:create heroku-postgresql:essential-0 --app <HEROKU_APP_NAME>

# Cache — used for streaming, TTS, and the DC + Tableau metadata catalogs
heroku addons:create heroku-redis:mini --app <HEROKU_APP_NAME>

# Managed Inference — provides Claude, Kimi, MiniMax via OpenAI-compatible API
heroku addons:create heroku-inference --app <HEROKU_APP_NAME>

# Scheduler — runs the metadata cache refresh jobs
heroku addons:create scheduler:standard --app <HEROKU_APP_NAME>
```

After installation, set the user-supplied config vars from §3.1:

```bash
heroku config:set \
  SF_CLIENT_ID='...' \
  SF_CLIENT_SECRET='...' \
  SF_LOGIN_URL='https://login.salesforce.com' \
  SF_REDIRECT_URI='https://<HEROKU_APP_NAME>.herokuapp.com/callback' \
  APP_URL='https://<HEROKU_APP_NAME>.herokuapp.com' \
  NODE_ENV=production \
  DEMO_BANKER_USER_ID='...' \
  DEMO_BANKER_NAME='...' \
  INFERENCE_MODEL_ID='claude-4-5-sonnet' \
  --app <HEROKU_APP_NAME>
```

Then, if the user wants Ask My Data / Analyze, mirror the inference vars (the add-on populates `INFERENCE_URL` + `INFERENCE_KEY`; the Onyx/Ivory stacks reuse the same endpoint + key with different model IDs):

```bash
PRIMARY_URL=$(heroku config:get INFERENCE_URL --app <HEROKU_APP_NAME>)
PRIMARY_KEY=$(heroku config:get INFERENCE_KEY --app <HEROKU_APP_NAME>)

heroku config:set \
  HEROKU_INFERENCE_ONYX_URL="$PRIMARY_URL" \
  HEROKU_INFERENCE_ONYX_KEY="$PRIMARY_KEY" \
  HEROKU_INFERENCE_ONYX_MODEL_ID='kimi-k2-thinking' \
  HEROKU_INFERENCE_IVORY_URL="$PRIMARY_URL" \
  HEROKU_INFERENCE_IVORY_KEY="$PRIMARY_KEY" \
  HEROKU_INFERENCE_IVORY_MODEL_ID='minimax-m2' \
  --app <HEROKU_APP_NAME>
```

**Configure Heroku Scheduler** — open the dashboard and add two jobs:

```bash
heroku addons:open scheduler --app <HEROKU_APP_NAME>
```

In the UI, add:

| Job | Frequency |
|---|---|
| `npm run refresh:dc-metadata` | Every hour (the script self-skips if the cache is < 12h old) |
| `npm run refresh:tableau-sdms` | Daily |

These rebuild the Data Cloud DMO catalog and Tableau SDM catalog into Redis so the agent can ground tool calls without making metadata calls on every turn. The first run can be triggered manually from the dashboard once the app is deployed.

---

## 5. Local Setup & Smoke

Have the user run these locally in the cloned repo:

```bash
npm install
cp .env.example .env
# Open .env and fill in the values from §3.1.
# For local development, SF_REDIRECT_URI = http://localhost:3000/callback
# DATABASE_URL and REDIS_URL can be left blank locally if they don't need
# DB-backed features; otherwise point them at local Postgres/Redis.

# Capture a banker access token for smoke scripts
npm run sf:login
# This opens a browser, completes PKCE login against SF_LOGIN_URL,
# and writes SF_ACCESS_TOKEN + SF_INSTANCE_URL to .env.

# End-to-end MCP smoke — connects all three Salesforce MCPs, lists tools, fires a Claude probe
npm run verify:mcp

# Start the dev server
npm run dev
```

Open `http://localhost:3000`. Sign in via the Salesforce button. You should land back on `/` with a populated Morning Brief streaming in within 5–15 seconds, with a collapsible reasoning trail showing MCP tool calls.

If `verify:mcp` fails, see §8 before deploying.

---

## 6. First Deploy

```bash
heroku git:remote -a <HEROKU_APP_NAME>
git push heroku main
heroku logs --tail --app <HEROKU_APP_NAME>
```

Watch the release phase. The `Procfile` runs `node scripts/apply-schema.cjs` against `DATABASE_URL` before the web dyno starts — this creates the schema idempotently. If the release fails, the slug rolls back and the previous build keeps serving; fix locally and push again.

Once the release succeeds:

```bash
curl -sf https://<HEROKU_APP_NAME>.herokuapp.com/api/health
# Expect: {"ok":true,...}
```

---

## 7. Post-Deploy Verification Checklist

Walk through these. If any step fails, capture the symptom and consult §8.

1. ✅ `GET /api/health` returns `200 {ok: true}`.
2. ✅ Visit `/` — redirected to Salesforce login → back to `/callback` → land on `/` with the banker name.
3. ✅ Morning Brief streams text within ~10 seconds.
4. ✅ Reasoning trail (collapsible row beneath the brief) shows entries prefixed `salesforce_crm__`, `data_360__`, `tableau_next__`.
5. ✅ Type into the Ask bar: *"Show me recent life events across my book."* — reasoning trail should show `data_360__post_dc_query_sql`.
6. ✅ `/ask-data` and `/analyze/[modelId]` load without errors *(only required if Onyx + Ivory inference stacks are configured)*.
7. ✅ In the Heroku Scheduler dashboard, manually run `npm run refresh:dc-metadata` once to seed the Redis cache. Confirm it exits 0.

---

## 8. Troubleshooting

Common failures and what they mean.

| Symptom | Cause | Fix |
|---|---|---|
| `OAUTH_CODE_CRED_SCOPE_TOO_LONG` during login | ECA scope list contains more than the three required scopes | Edit the ECA, remove all scopes except `mcp_api`, `cdp_api`, `refresh_token, offline_access`. |
| Data Cloud MCP returns 0 tools | `cdp_api` scope missing from ECA | Add `cdp_api` to the ECA's selected scopes; have the user log out and log back in. |
| `redirect_uri_mismatch` during OAuth | `SF_REDIRECT_URI` does not exactly match an entry in the ECA Callback URL list | Compare scheme + host + path character-by-character. The ECA list must contain the *public* origin used by Heroku, not the internal dyno hostname. |
| `verify:mcp` reports `INVALID_SESSION_ID` | Captured `SF_ACCESS_TOKEN` has expired | Re-run `npm run sf:login`. |
| Release phase fails with schema error | Postgres add-on not yet provisioned, or `DATABASE_URL` not set | Verify with `heroku config:get DATABASE_URL`. The add-on populates this automatically; if it's missing, re-add the add-on. |
| Scheduler job exits with auth error | Scheduler dyno has no banker access token | Expected on first run — log into the deployed app once as the banker; the `/callback` route upserts the credentials needed by the scheduler. Re-run the job. |
| Morning Brief never streams; reasoning trail empty | Inference add-on not provisioned, or `INFERENCE_KEY` missing | `heroku config | grep INFERENCE`. If empty, the add-on did not install — check Heroku dashboard. |
| `/api/tts` returns 401 | TTS auth gate is enforced (default) | Either sign in via Salesforce first, or set `TTS_REQUIRE_SF_AUTH=0` for a controlled demo (still rate-limited). |
| Local `.env` values appear correct but auth fails on Heroku | Curly quotes (`"…"`) instead of straight quotes (`"…"`) in `.env` | Re-type the values in a plain editor; do not paste from chat or rich-text docs. |
| Redis connection errors after long dev sessions | Heroku Redis Mini has a 20-connection cap; idle sockets accumulate | Restart the dev server, or upgrade to Redis Premium-0 in production. |

---

## 9. Optional: Seed Demo Data

If the user wants the realistic banker demo experience (six synthetic clients with life events, transactions, etc.), run these against their org:

```bash
# Requires SF_ACCESS_TOKEN in .env (from `npm run sf:login`)
npm run seed:dc          # Seeds Data Cloud DMOs
npm run seed:ask-data    # Seeds Ask My Data thread + sample records
```

These scripts are idempotent — safe to re-run. See `docs/SEED_DATA_SPEC.md` for the schema of what they create.

---

## 10. What's Next

After bootstrap is complete and verified:

- The user's running app is at `https://<HEROKU_APP_NAME>.herokuapp.com`.
- Day-to-day operations (deploys, secrets rotation, incident triage) are documented in `docs/OPERATIONS.md`.
- Architecture, agent loop, and MCP integration are documented in `docs/ARCHITECTURE.md`.
- Prompt customization is documented in `docs/LLM_PROMPT_GUIDE.md`.

The agent should hand the user off at this point with links to those docs.
