# Cursor — Salesforce-Hosted MCP Setup (developer-side)

> **Why this exists.** The Horizon app at runtime connects to three Salesforce-Hosted MCP servers — `salesforce_crm`, `data_360`, `tableau_next` — plus the `heroku_toolkit` MCP. We want the **same** MCPs available inside Cursor during development, so the IDE agent can ground designs (seed specs, prompt changes, debugging) against real org schemas instead of guessing. This is especially important when designing reference architecture that touches Data Cloud DMOs or Tableau Next datasources, where the LLM has no safe priors.
>
> **This does not change the production path.** The app's `lib/llm/heroku.ts` + `lib/mcp/client.ts` still owns all runtime MCP orchestration for end-users. `.cursor/mcp.json` only affects what your IDE's agent can reach while you're coding.

---

## TL;DR

1. **First time only** — add this to `~/.zshrc` (or your shell rc):
   ```bash
   # Horizon: make SF + Heroku MCP creds available to Cursor's MCP loader.
   if [ -f "$HOME/Documents/Git/Headless_JDO/.env" ]; then
     set -a
     source "$HOME/Documents/Git/Headless_JDO/.env"
     set +a
   fi
   ```
   Then restart Cursor from a fresh terminal (or log out / log back in).

2. **Every ~2 hours** (when the Salesforce token expires, and you see `Invalid token` in the Cursor MCP Logs panel):
   ```bash
   npm run mcp:refresh
   source scripts/export-mcp-env.sh
   # Reload the MCP panel in Cursor:  Cmd+Shift+J → Features → Model Context Protocol → toggle off+on
   ```

3. **Verify** — open any Cursor chat and ask:
   > List all Data 360 tools available.

   You should see tool names like `data_360__getDcMetadata`, `data_360__runDataCloudSQL`, etc. surfaced in the agent's tool list.

---

## What got added to the repo

| File | Purpose |
|---|---|
| `.cursor/mcp.json` | Registers the 4 MCP servers with Cursor. URLs and header shapes mirror `lib/anthropic/mcp-servers.ts` and `lib/mcp/client.ts` exactly. Uses `${env:NAME}` interpolation so **no secrets live in the file** — safe to commit. |
| `scripts/export-mcp-env.sh` | One-shot shell helper that reads `.env` and exports the 4 vars Cursor needs (`SF_ACCESS_TOKEN`, `SF_INSTANCE_URL`, `INFERENCE_URL`, `INFERENCE_KEY`). Source it before launching Cursor from a terminal, or use the `~/.zshrc` trick in the TL;DR. |
| `package.json` → `mcp:refresh` script | Wraps `sf:login` and prints the next two manual steps so you don't have to remember them. |

## How Cursor loads these servers

Cursor's `.cursor/mcp.json` supports three transports — **stdio**, **SSE**, and **Streamable HTTP**. The Salesforce MCPs speak Streamable HTTP; Cursor picks that transport automatically when a server entry has a `url` key (and no `command`/`args`). The Heroku Inference toolkit speaks legacy SSE but lives at `${INFERENCE_URL}/mcp/sse`, which Cursor also supports via the same `url` field.

Cursor resolves `${env:NAME}` at server-load time from **its own process environment** — i.e. the shell it was launched in. It does **not** read the workspace `.env` for remote HTTP servers (only for stdio servers). That's why the helper script exists.

## The four servers at a glance

| Server (Cursor) | URL | Transport | Auth | Token source |
|---|---|---|---|---|
| `salesforce_crm` | `https://api.salesforce.com/platform/mcp/v1/platform/sobject-all` | Streamable HTTP | `Authorization: Bearer ${env:SF_ACCESS_TOKEN}` | `.env` (refreshed by `sf:login`) |
| `data_360` | `https://api.salesforce.com/platform/mcp/v1/custom/Data360MCP` | Streamable HTTP | Same SF token | Same |
| `tableau_next` | `https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP` | Streamable HTTP | Same SF token | Same |
| `heroku_toolkit` | `${INFERENCE_URL}/mcp/sse` | SSE | `Authorization: Bearer ${env:INFERENCE_KEY}` | `.env` (static, no refresh) |

All three SF MCPs share a single Salesforce access token — that's how the production app authenticates them too (see `lib/mcp/client.ts` lines 165–172).

## Token lifecycle

- The Salesforce access token the ECA issues is **short-lived (~2 hours)**. When it expires, every SF MCP will return `Invalid token` and Cursor's MCP Logs will show the failures.
- `scripts/sf-login.ts` does a full OAuth 2.1 + PKCE flow, writes the new token back to `.env`, and is already wired into `npm run sf:login`. `npm run mcp:refresh` is the convenience wrapper that runs it and reminds you to re-source + reload.
- `INFERENCE_KEY` is set by Heroku's inference add-on and does **not** rotate on a schedule — you only need to refresh it if the add-on is re-provisioned.

## When to use Cursor's MCPs vs. the DX MCP

Both are useful. Pick based on what you're asking:

| Question | Best tool |
|---|---|
| "What custom fields exist on the `FinServ__FinancialAccount__c` object?" | **DX MCP** — `run_soql_query` against `FieldDefinition` is faster and doesn't need an ECA token. |
| "What DMOs are registered in Data Cloud for this org?" | **Cursor `data_360`** — `data_360__getDcMetadata`. The DX MCP cannot reach Data Cloud. |
| "What datasources and calculated fields are on the executive dashboard?" | **Cursor `tableau_next`** — no DX-equivalent. |
| "Does the agent loop use this exact tool name?" | **Cursor `salesforce_crm`** — same server the app uses, so tool names and schemas are guaranteed to match. DX MCP uses different tool names. |
| "Run an Apex test / deploy metadata / scaffold an LWC." | **DX MCP** — those tools are not on the Hosted MCPs. |

Rule of thumb: when designing anything that **the Horizon app's LLM will later call**, use the Cursor MCPs so tool-name and schema shapes match 1:1.

## Troubleshooting

**Cursor MCP panel says a server has 0 tools / is red.**
Open `Cmd+Shift+U` → select **MCP Logs** from the channel dropdown. You'll see the raw error. The two common ones:

- `401 Invalid token` → Salesforce access token expired. Run `npm run mcp:refresh` and re-source.
- `getaddrinfo ENOTFOUND` → Cursor couldn't resolve the URL — usually means `${env:INFERENCE_URL}` didn't get substituted (shell didn't have it exported). Source `scripts/export-mcp-env.sh` and toggle the server off+on.

**`${env:SF_ACCESS_TOKEN}` appears literally in the Authorization header.**
Cursor found no value for that variable in its process env. Either (a) the `~/.zshrc` trick in the TL;DR wasn't applied, or (b) you launched Cursor from a GUI before sourcing the helper. Close Cursor entirely, then relaunch from a terminal you sourced the helper in, OR add the `~/.zshrc` snippet and log out/in.

**Refresh ran but tools still auth-fail.**
Cursor aggressively caches the MCP tool list. After `mcp:refresh`, go to `Cmd+Shift+J → Features → Model Context Protocol`, toggle the affected server off then on. If that fails, fully restart Cursor.

**"Is it safe to commit `.cursor/mcp.json`?"**
Yes. It contains only `${env:NAME}` placeholders, no secrets. `.env` stays gitignored.
