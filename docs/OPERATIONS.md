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

Add both jobs in the dashboard. Dyno size **Basic** is plenty — DC refresh is ~75s, Tableau is ~10s.

**Manual bump (forces a refresh bypassing the skip gate):**

```bash
# Local (requires REDIS_URL from Heroku config):
REDIS_URL=$(heroku config:get REDIS_URL) DC_METADATA_FORCE=1 npm run refresh:dc-metadata
TABLEAU_SDM_FORCE=1 npm run refresh:tableau-sdms

# On the Heroku dyno:
heroku run --app headless-jdo npm run refresh:dc-metadata
```

**Diagnostic endpoint:**

```bash
curl https://<app-url>/api/admin/refresh-dc-cache
```

Returns JSON with `cached`, `generatedAt`, `ageHours`, `survivingDmos`, and the top 10 DMOs by row count. Use to confirm a refresh landed after a manual bump.

## Reasoning trail: triage cheatsheet

When the UI shows yellow “schema mismatch / handled” or red failures:

| Pattern in trail | Likely fix |
|------------------|------------|
| `unknown column` on `data_360.post_dc_query_sql` | Model guessed a column not present on that DMO. Verify the DC metadata cache is warm (`curl /api/admin/refresh-dc-cache`); if stale, force-refresh and redeploy. |
| `Unknown tool` rejection on a filtered tool (e.g. `list_semantic_models`, `get_dc_metadata`) | Model tried to call a tool that the cache-aware filter has stripped. Expected behavior when a prompt still references the filtered tool — search `lib/prompts/` for the directive and rewrite to point at the catalog in the system prompt. |
| `MALFORMED_QUERY` / `unexpected token` on `salesforce_crm.soqlQuery` | Bad SOQL date literal (e.g. `NEXT_7_DAYS` instead of `NEXT_N_DAYS:7`, or quoted `ActivityDate`). See [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md). |
| `504 Gateway Timeout — <server>.<tool> exceeded Nms` | Per-tool client-side timeout fired. Legitimate upstream slowness — check if a specific Tableau semantic model or DC DMO is consistently slow and consider narrowing the utterance or dropping the call. |
| `blocked by schema-mismatch breaker` | Expected after a bad Data Cloud or SOQL shape — prevents tool-slot burn; narrative should degrade gracefully. |

After fixing prompt text, **bump** the relevant `*_PROMPT_VERSION` in `lib/prompts/` and redeploy.
