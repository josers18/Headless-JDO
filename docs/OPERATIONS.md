# Operations & release procedure

## Environments

| Environment | Typical URL | Purpose |
|-------------|-------------|---------|
| Local | `http://localhost:3000` | Development |
| Production | Heroku app URL (see README) | Demo / contest submission |

## Deploy to Heroku

Prerequisites: Heroku CLI, access to the app, `heroku` git remote.

```bash
heroku git:remote -a <app-name>   # once per clone
git push heroku main
```

After deploy: confirm `/api/health` and run smoke checks if credentials are configured (`npm run smoke:api` against the public URL when env allows).

### Config vars (production)

Set on the Heroku app (not in git): `APP_URL`, `SF_REDIRECT_URI` (must include `https://…/callback`), `INFERENCE_*`, Salesforce OAuth pair, `DATABASE_URL`, `REDIS_URL`, demo banker fields as needed. Mirror names in [`.env.example`](../.env.example).

### GitHub vs Heroku

- **`origin`** — source control (GitHub).
- **`heroku`** — application releases. Pushing to GitHub does not deploy unless CI/CD is wired; this project commonly deploys with **`git push heroku main`**.

## Quality gates (before merge or release)

```bash
npm run lint
npm run typecheck
npm run build
```

Optional with a configured `.env`:

```bash
npm run verify:mcp
npm run smoke:api
```

## Secrets rotation

If any key was exposed (chat, screenshot, old commit): rotate **Salesforce ECA secret** (`SF_CLIENT_SECRET`) and **Heroku Inference keys** (`INFERENCE_KEY`; `HEROKU_INFERENCE_ONYX_KEY` if the Kimi fallback is configured). Never commit real tokens; use placeholders in documentation.

## Incident checklist

1. Check Heroku **logs** (`heroku logs --tail`) for H12 timeouts or 503s on `/api/*`.
2. Confirm OAuth callback URL matches the live origin.
3. Open **Reasoning trail** in the UI for failed sections (tool errors surface there by design).
4. Re-run `verify:mcp` locally with a fresh `npm run sf:login` if MCP calls fail consistently.

## Scheduled jobs (Heroku Scheduler)

Two cron entries keep the metadata caches warm. See
[ARCHITECTURE.md#metadata-cache-layer](./ARCHITECTURE.md#metadata-cache-layer)
for why the caches exist.

| Job | Command | Frequency | Real-work cadence |
|-----|---------|-----------|-------------------|
| DC metadata refresh | `npm run refresh:dc-metadata` | Every hour at :00 | ~every 12h (internal skip gate via `DC_METADATA_MIN_AGE_HOURS`) |
| Tableau SDM refresh | `npm run refresh:tableau-sdms` | Daily at 00:00 UTC | Daily (when cache < `TABLEAU_SDM_MIN_AGE_HOURS`) |

**Cache TTLs:**
- `dc:metadata:v1:default` — **25h** (survives one fully missed refresh cycle)
- `tableau:sdms:v1:default` — **26h** (2h buffer past daily cadence)

**Setup (once per app):**

```bash
heroku addons:open scheduler --app headless-jdo
```

Add both jobs in the dashboard. Dyno size **Basic** is plenty — DC refresh is ~100s, Tableau is ~10s.

### How the scheduler authenticates (last-good banker creds)

Scheduler dynos can't sign in interactively, but Salesforce's MCP
endpoints want a banker bearer token. Horizon uses a **last-good banker
credentials** pattern:

1. On every successful `/callback` OAuth exchange, the route upserts
   the banker's `refresh_token` + `instance_url` + `sf_user_id` into
   the **singleton `scheduler_credentials` row** in Postgres.
2. Refresh scripts call `scripts/lib/resolveSfToken.ts` at job start
   to resolve a fresh access token via this priority order:
   1. `SF_ACCESS_TOKEN` env var (set by the admin route's child
      process from the live banker session cookie, or by local dev).
   2. `SF_REFRESH_TOKEN` config var (designated service principal
      — for prod-grade rollout, set this and skip the DB row).
   3. `scheduler_credentials.refresh_token` row → exchanged for a
      fresh access token via OAuth refresh-token grant.
3. The script proceeds with whichever access token resolved.

**Self-heal:** every banker login replaces the row. As long as one
human signs in within the refresh-token revocation window (Salesforce
default: ~90 days idle), the scheduler stays alive without intervention.

**Schema migration runs on every release** via `Procfile`'s release
phase (`scripts/apply-schema.cjs`). Schema is idempotent (`create
table if not exists`) — release fails (rollback) if the migration
errors, so the slug never goes live with a missing schema.

### Manual refresh (forces a refresh bypassing the skip gate)

**On the Heroku dyno** (uses `scheduler_credentials` row exactly like
the scheduled jobs):

```bash
heroku run --app headless-jdo "DC_METADATA_FORCE=1 npm run refresh:dc-metadata"
heroku run --app headless-jdo "TABLEAU_SDM_FORCE=1 npm run refresh:tableau-sdms"
```

**Local** — `--env-file-if-exists=.env` is on the npm scripts, so they
work either with `.env` (dev) or with env vars exported by your shell:

```bash
set -a; source .env; set +a
DC_METADATA_FORCE=1 npm run refresh:dc-metadata
TABLEAU_SDM_FORCE=1 npm run refresh:tableau-sdms
```

### Dev browser path (recommended for local iteration)

Avoids the `SF_ACCESS_TOKEN` expiry problem entirely by pulling a
fresh token from the banker's logged-in session cookie:

```
http://localhost:3000/api/admin/refresh-dc-cache?run=1&tool=dc&force=1
http://localhost:3000/api/admin/refresh-dc-cache?run=1&tool=tableau&force=1
http://localhost:3000/api/admin/refresh-dc-cache?run=1&tool=both&force=1
```

The admin route spawns the refresh script as a child process and
injects the live session token as `SF_ACCESS_TOKEN`. Tab hangs ~100s
for DC, ~15s for Tableau.

### Diagnostic endpoint

```bash
curl https://<app-url>/api/admin/refresh-dc-cache
```

Returns JSON with `cached`, `generatedAt`, `ageHours`, `survivingDmos`,
top 10 DMOs by row count, **and** the Tableau SDM slice (`tableau.cached`,
`tableau.survivingSdms`, `tableau.apiNames` — the full list of valid
SDM apiNames). Use to:
- Confirm a refresh landed after a manual bump.
- Verify which SDMs are visible to the model (when triaging
  `INVALID_INPUT — don't have access` rejections that may actually be
  hallucinated apiNames — see [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md)).

**Connection-limit note:** the current Heroku Redis plan is **Mini**
(25MB, 20-connection cap). Hammering the admin URL rapidly during local
iteration can stack orphaned connections and cause TLS-handshake-terminated
errors that look like credential rotation but clear after restart of
the dev server or ~5 minutes of idle. Plan upgrade to Premium-0 (40+
connections, eviction enabled) is recommended before broader rollout.
The refresh scripts use `redisSetOnce` (short-lived TLS connection)
for the final write to avoid idle-socket-severed failures.

## Section-level snapshot cache (Today)

The 5 expensive Today routes — `/api/brief`, `/api/priority`, `/api/pulse`, `/api/drafts`, `/api/arc` — wrap their SSE writers in `makeCacheableSseStream` from `lib/sse/stream.ts`. First hit per banker per local-day pays the agent loop; subsequent hits replay the captured SSE event sequence from Redis so reasoning trail + inference badge survive. Lives separately from the metadata cache (DC DMOs / Tableau SDMs) — different scope, different lifetime.

| Aspect | Value |
|--------|-------|
| Redis key shape | `horizon:section:v1:<route>:<bankerUserId>:<localDay>` (e.g. `horizon:section:v1:brief:005am000003PbCLAA0:2026-05-08`) |
| TTL | 36h (survives one fully missed local-day boundary) |
| Local-day source | `localDayInTz()` in `lib/sse/sectionCache.ts`, fed by `DEMO_BANKER_TZ` env (default `America/New_York`) |
| Bypass | append `?refresh=1` to any of the 5 routes; the section component listeners (e.g. `HORIZON_REFRESH_BRIEF`) already do this |
| User-facing refresh | "Refresh today" entry in the `UserMenu` dropdown — fans out all 5 `HORIZON_REFRESH_*` events |
| Pull-to-refresh on mobile | `PullToRefresh.tsx` dispatches the same 5 events |
| Persistence guard | only writes when writer didn't throw AND controller wasn't canceled AND ≥1 `text_delta` event observed AND captured array non-empty |
| Live signals | deliberately NOT cached — `/api/signals` polls every 45s independently |

### Wiping the section cache (manual ops)

If a captured event sequence is bad (e.g. an upstream timeout was preserved, or a prompt change makes existing sequences obsolete), wipe the keys via the Heroku Redis CLI from a one-off dyno:

```bash
heroku run --app headless-jdo --no-tty 'node -e "const Redis=require(\"ioredis\"); const c=new Redis(process.env.REDIS_URL,{tls:{rejectUnauthorized:false}}); (async()=>{const keys=await c.keys(\"horizon:section:v1:*\"); for(const k of keys) await c.del(k); console.log(\"deleted\",keys.length); await c.quit();})()"'
```

Next page load per section refills the cache cleanly.

## Reasoning trail: triage cheatsheet

When the UI shows yellow “schema mismatch / handled” or red failures:

| Pattern in trail | Likely fix |
|------------------|------------|
| `unknown column` on `data_360.post_dc_query_sql` | Model guessed a column not present on that DMO. Verify the DC metadata cache is warm (`curl /api/admin/refresh-dc-cache`); if stale, force-refresh and redeploy. |
| Owner / user pivot on a DC transaction DMO (`OwnerUserId__c`, `ssot__OwnerUserId__c`, etc.) | Model reaching for a CRM-style ownership filter that doesn't exist on Data Cloud row level. Caught by preflight; system prompt v1.6.0+ explicitly forbids the pattern and instructs filtering by `accountid__c` using the account list from CRM. |
| `Semantic model apiName "X" does not exist in this org` | Preflight caught a hallucinated SDM apiName before it hit the network. Real apiNames are listed in the rejection's `instruction` field. Tableau itself returns `INVALID_INPUT — you don't have access` for unknown apiNames, which is misleading; the runtime catches it locally. |
| `INVALID_INPUT — don't have access to the semantic model` (rare, post-preflight) | Real org permission gap. Post-preflight, this means the cache and the banker's token disagree on visibility. Most often the cache was refreshed by an admin and the banker doesn't have the SDM. Trips the breaker on first occurrence (no retry storm). |
| `Unknown tool` rejection on a filtered tool (e.g. `list_semantic_models`, `get_dc_metadata`) | Model tried to call a tool that the cache-aware filter has stripped. Expected behavior when a prompt still references the filtered tool — search `lib/prompts/` for the directive and rewrite to point at the catalog in the system prompt. |
| `MALFORMED_QUERY` / `unexpected token` on `salesforce_crm.soqlQuery` | Bad SOQL date literal (e.g. `NEXT_7_DAYS` instead of `NEXT_N_DAYS:7`, or quoted `ActivityDate`), OR a SQL-style function like `NOW()` / `CURRENT_TIMESTAMP` / `GETDATE()` / `SYSDATE` (SOQL is not SQL). System prompt v1.6.1+ §B.8 forbids these explicitly; runtime `preflightSalesforceSoql` intercepts them before dispatch. See [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md). |
| `504 Gateway Timeout — tableau_next.analyze_data exceeded 40000ms` | Today path's Tableau Q&A timeout (20s → 25s on 2026-05-06 → **40s on 2026-05-07**). Every Today route streams via SSE from first byte so Heroku's 30s H12 idle timer doesn't apply (bytes flow continuously while analyze is in flight). The 40s cap is purely so a wedged Tableau call eventually fails the breaker. Analyze surface uses a separate 45s cap (`firstPartyTableauNext.ts`) since it runs analyze_data as a single-tool turn. |
| `504 Gateway Timeout — <other server>.<tool> exceeded Nms` | Per-tool client-side timeout fired. Legitimate upstream slowness — check if a specific DC DMO is consistently slow and consider narrowing the utterance or dropping the call. |
| `blocked by schema-mismatch breaker` | Expected after a bad Data Cloud or SOQL shape — prevents tool-slot burn; narrative should degrade gracefully. |
| `Duplicate <tool> suppressed.` | Dispatcher-level duplicate suppression. Per-iteration (multiple calls to same tool in one LLM response) or turn-wide (budget-limited tools like `analyze_data` that already ran successfully). Expected when the model hedges; the narrative should still complete on a subsequent iteration. |
| `Catalog already in system prompt.` | `get_dc_metadata` was called but the cache is warm and the tool has been hidden. Expected feedback to the model — should re-read the injected catalog block for schema. Not a bug. |
| Agent returned but **no narrative rendered** | Every silent-exit path now emits a fallback `token` event (iteration cap, circuit trip, empty-tool-calls, stream exception). If the UI shows nothing, check the client hook for `token` parsing — not an agent-side issue. |
| Scheduled refresh failed silently — cache went cold | Most common cause: nobody has signed in recently AND no `SF_REFRESH_TOKEN` config var is set, so `scheduler_credentials` row is missing or the refresh_token was revoked. Sign in once via `/callback` (or set `SF_REFRESH_TOKEN`), then re-run the job. See `scripts/lib/resolveSfToken.ts`. |

After fixing prompt text, **bump** the relevant `*_PROMPT_VERSION` in `lib/prompts/` and redeploy.
