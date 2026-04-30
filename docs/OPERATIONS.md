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

## Reasoning trail: triage cheatsheet

When the UI shows yellow “schema mismatch / handled” or red failures:

| Pattern in trail | Likely fix |
|------------------|------------|
| `unknown column` on `data_360.postDcQuerySql` | Model guessed a column not in `getDcMetadata` for that DMO (e.g. `AccountId__c`). Tighten prompts or accept Data Cloud skip for that turn. |
| `MALFORMED_QUERY` / `unexpected token` on `salesforce_crm.soqlQuery` | Bad SOQL date literal (e.g. `NEXT_7_DAYS` instead of `NEXT_N_DAYS:7`, or quoted `ActivityDate`). See [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md). |
| `blocked by schema-mismatch breaker` | Expected after a bad Data Cloud or SOQL shape — prevents tool-slot burn; narrative should degrade gracefully. |

After fixing prompt text, **bump** the relevant `*_PROMPT_VERSION` in `lib/prompts/` and redeploy.
