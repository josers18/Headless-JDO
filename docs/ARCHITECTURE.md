# Horizon — Architecture

Horizon is a single Next.js application deployed to Heroku. The browser never calls Salesforce MCP servers directly; the server-side agent loop orchestrates tools and streams results over SSE.

## Request flow

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI /app/page]
  end
  subgraph Heroku["Next.js on Heroku"]
    API["/api/* routes"]
    Agent["lib/llm/heroku.ts"]
    MCP["lib/mcp/client.ts"]
  end
  subgraph Infra
    INF["Heroku Inference\nClaude 4.5 Sonnet"]
  end
  subgraph Salesforce
    CRM["SObject MCP"]
    DC["Data 360 MCP"]
    TN["Tableau Next MCP"]
  end
  UI -->|SSE| API
  API --> Agent
  Agent -->|OpenAI-compat chat| INF
  Agent --> MCP
  MCP --> CRM
  MCP --> DC
  MCP --> TN
```

## SSE to the browser (reasoning trail + text)

```mermaid
sequenceDiagram
  participant UI as React (AskBar, Brief, …)
  participant API as Next /api/* route
  participant Agent as lib/llm/heroku.ts
  participant MCP as MCP client
  UI->>API: POST (e.g. ask, brief) + Accept text/event-stream
  API->>Agent: stream loop
  loop Until model done
    Agent->>MCP: tool_calls (parallel per turn)
    MCP-->>Agent: tool results
    Agent-->>API: tokens + trail steps
    API-->>UI: SSE events (narrative + tool_use / tool_result)
  end
```

The **reasoning trail** is a first-class product surface: bankers see which tools ran, including handled schema or SOQL errors, without raw tokens dumping stack traces into prose.

## MCP tool loop (conceptual)

1. The model receives flattened tool definitions (`salesforce_crm__*`, `data_360__*`, `tableau_next__*`, optional `heroku_toolkit__*`).
2. The model emits `tool_calls`; the server dispatches them in parallel to the right MCP transport (Streamable HTTP for Salesforce-hosted servers).
3. Tool results are returned as `role: tool` messages; the loop repeats until the model finishes or iteration limits are hit.
4. The API forwards **text deltas** and **reasoning-trail steps** to the client as SSE events.

Runtime **constraints** on tool use (metadata-before-SQL, SOQL date literal spelling, Tableau model binding, etc.) are enforced in prompts (`lib/prompts/system.ts`) and, for some paths, in dispatch preflight. See [**LLM_PROMPT_GUIDE.md**](./LLM_PROMPT_GUIDE.md) for a contributor-oriented catalog of known failure modes.

## Key source locations

| Area | Path |
|------|------|
| Agent loop | `lib/llm/heroku.ts` |
| MCP client & transports | `lib/mcp/client.ts`, `lib/mcp/tools.ts` |
| Versioned prompts | `lib/prompts/*.ts` |
| Main surface | `app/page.tsx`, `components/horizon/*` |
| SSE agent helper (client) | `lib/client/useAgentStream.ts` |

## Salesforce auth

OAuth 2.1 + PKCE obtains a token with the `mcp_api` scope. That bearer token is passed into MCP sessions. Session cookies gate which API routes run with a live token (see `lib/salesforce/token.ts` and `/api/auth/*` patterns).

For deeper product constraints (no navigation rails, reasoning trail as a feature), refer to your team’s **Horizon build spec** if you maintain one locally (this repo’s `.gitignore` may exclude it). **Prompt and MCP hygiene** for engineering are summarized in [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md).
