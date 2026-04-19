# Horizon

> The headless home page for the relationship banker. Built on Salesforce Headless 360 + Anthropic Claude Sonnet 4 with native MCP.

This is the submission for the DAX "So You Think You Can AI?" Innovation Contest. The authoritative build spec lives in [`CLAUDE.md`](./CLAUDE.md). When in doubt, the spec wins.

## Stack

- Next.js 14 (App Router) · React 18 · TypeScript strict · Tailwind CSS
- Anthropic Claude Sonnet 4 via Messages API with `mcp_servers`
- Three Salesforce-hosted MCPs: SObject All, Data 360, Tableau Next
- Heroku Postgres + Heroku Key-Value Store
- Single Heroku `web` dyno, Node 22

## Quickstart

```bash
# 1. Install
npm install

# 2. Copy env template and fill in the blanks
cp .env.example .env
# edit .env → add ANTHROPIC_API_KEY, DEMO_BANKER_USER_ID, etc.

# 3. Apply the DB schema (local or Heroku)
psql "$DATABASE_URL" -f lib/db/schema.sql

# 4. Smoke-test all 3 MCPs (Day 1 done-when)
npm run verify:mcp

# 5. Run the dev server
npm run dev  # http://localhost:3000
```

## Day 1 checklist (Apr 18)

- [x] Heroku app `headless-jdo` provisioned with Node buildpack + Postgres + Key-Value Store
- [x] Salesforce Connected App credentials loaded into both Heroku config vars and `.env`
- [x] Next.js scaffold in place, boots + builds
- [x] `/api/connect` + `/callback` wired to PKCE OAuth
- [ ] `npm run verify:mcp` prints PASS — requires `ANTHROPIC_API_KEY` and a Connected App with Client Credentials (or `SF_ACCESS_TOKEN`)

## Deploy to Heroku

The workspace currently sits inside the larger `~/Documents/Git` repo. When you're ready to deploy:

```bash
# from the Headless_JDO/ directory, initialize a clean repo:
git init
git add .
git commit -m "Horizon — initial scaffold"
heroku git:remote -a headless-jdo
git push heroku HEAD:main
```

Heroku will auto-detect Node, run `npm install && npm run build`, and start via the `Procfile` (`web: npm start`).

## Where things live

See `CLAUDE.md` §4 for the project layout. Key hot paths:

- `lib/anthropic/client.ts` — the one place that calls Claude
- `lib/anthropic/mcp-servers.ts` — **the one place the MCP URLs live**
- `lib/prompts/*` — versioned prompts, treated as code
- `lib/salesforce/oauth.ts` — auth-code + refresh + client-credentials flows
- `scripts/verify-mcp.ts` — the Day-1 smoke test

## Anti-patterns (from CLAUDE.md §12 — do not break these)

- No direct MCP calls from the frontend. Everything goes through Claude.
- No multi-page navigation. The home page is the app.
- No spinners. Stream tokens or shimmer.
- No Lightning chrome. Think Stripe/Arc/Linear/Mercury.
