# Horizon — Build Specification

> **The headless home page for the relationship banker.**
> Built for the DAX "So You Think You Can AI?" Innovation Contest.
> Submission deadline: April 27, 2026.

This is the authoritative build spec. When in doubt, this document wins. If a user request conflicts with this spec, surface the conflict before acting.

---

## 1. Thesis & Non-Negotiables

Horizon is a physical manifestation of the **Salesforce Headless 360** vision announced at TDX 2026. The product answers Parker Harris's question *"Why should you ever log into Salesforce again?"* for the relationship-banker persona in financial services.

**Core principles — do not violate:**

1. **No navigation.** There are no tabs, menus, or nav rails. The home page IS the application. Everything comes to the banker.
2. **The conversation is the interface.** Every non-trivial interaction can be spoken or typed. The agent does the work.
3. **Agent-first, UI-second.** Claude Sonnet 4 orchestrates the three Salesforce-hosted MCP servers. The UI is a rendering surface for agent output, not a navigation tree.
4. **Reasoning is transparent.** Every agent output has a collapsible "reasoning trail" showing which MCP tools were called and why. This is a feature, not a debug affordance.
5. **Premium fintech aesthetic.** Think Stripe, Arc, Linear, Mercury — not Lightning Experience. Typography-driven, generous whitespace, subtle motion.

If a proposed change makes the product *more* like traditional Salesforce, reject it.

---

## 2. Tech Stack (fixed — do not substitute)

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript (strict), Tailwind CSS, shadcn/ui
- **Backend:** Next.js API routes (Node runtime), deployed as a single app on Heroku
- **LLM:** Claude 4.5 Sonnet via **Heroku Managed Inference** (OpenAI-compatible `/v1/chat/completions`). We drive the MCP tool loop ourselves — `lib/mcp/client.ts` opens live MCP sessions to the three Salesforce MCPs, `lib/mcp/tools.ts` flattens MCP tool schemas into OpenAI `function` specs, and `lib/llm/heroku.ts` runs the agent loop (model → `tool_calls` → parallel MCP dispatch → `role: tool` results → repeat). Anthropic direct is retained as an optional fallback (`LLM_PROVIDER=anthropic`) that uses the native `mcp_servers` parameter, but is not the default. The pivot to Heroku was made on 2026-04-18 after sustained Anthropic billing issues; Heroku Flex credits are paid up-front via the heroku-inference add-on.
- **MCP servers (Salesforce-hosted, all three required):**
  - `https://api.salesforce.com/platform/mcp/v1/platform/sobject-all` — CRM data & mutations (Streamable HTTP transport)
  - `https://api.salesforce.com/platform/mcp/v1/custom/Data360MCP` — Data 360 unified data via SQL (Streamable HTTP)
  - `https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP` — Tableau Next semantic layer + Analytics Q&A (Streamable HTTP)
- **MCP toolkit (optional 4th server, Heroku-hosted):** `${INFERENCE_URL}/mcp/sse` — legacy SSE transport. Unified endpoint for custom MCPs registered to the `heroku-inference` add-on. Currently empty; attached automatically when `INFERENCE_URL` + `INFERENCE_KEY` are set.
- **MCP client:** `@modelcontextprotocol/sdk` v1.29+. Per-server transport selection (Streamable HTTP for SF, SSE for Heroku toolkit). Bearer auth injected via `requestInit.headers` and `eventSourceInit.fetch` wrappers.
- **Data:** Heroku Postgres (session state, briefing history, preferences), Heroku Key-Value Store (Redis) for streaming signals
- **Auth:** Salesforce OAuth 2.0 (User-Agent or Web Server flow) to obtain access tokens for the MCP servers
- **Voice (MVP):** Web Speech API (SpeechSynthesis). If time permits, swap to ElevenLabs.
- **Streaming:** Server-Sent Events (SSE) for the agent "thinking" trail and live signal feed
- **Deployment:** Heroku (single `web` dyno, Node.js buildpack)

Do not introduce new frameworks, new UI libraries, or new LLM providers without explicit approval.

---

## 3. Architecture

```
┌────────────────────────────────────────────────────────┐
│                    Next.js App (Heroku)                │
│                                                        │
│  ┌──────────────┐        ┌──────────────────────┐     │
│  │  React UI    │◄──SSE──┤  /api/* routes        │     │
│  │  (Horizon)   │        │  (orchestrator)       │     │
│  └──────────────┘        └──────────┬───────────┘     │
│                                     │                  │
│                          ┌──────────▼──────────┐      │
│                          │  lib/llm/heroku.ts   │      │
│                          │  agent loop          │      │
│                          │  (Claude 4.5 Sonnet) │      │
│                          └──────┬───────┬───────┘      │
│                                 │       │              │
│                         OpenAI-compat   │              │
│                                 │       │              │
│                          ┌──────▼──┐    │              │
│                          │ Heroku  │    │              │
│                          │Inference│    │              │
│                          └─────────┘    │              │
│                                         │              │
│                          ┌──────────────▼──────────┐   │
│                          │   lib/mcp/client.ts      │   │
│                          │   (MCP SDK, per-server   │   │
│                          │    transport selection)  │   │
│                          └──┬───────┬───────┬───────┘   │
└─────────────────────────────┼───────┼───────┼───────────┘
                              │       │       │
         ┌────────────────────┘       │       └─────────────┐
         ▼                            ▼                     ▼
┌──────────────────┐      ┌──────────────────┐   ┌──────────────────┐
│ SObject All MCP  │      │  Data 360 MCP    │   │ Tableau Next MCP │
│ (Salesforce)     │      │  (Salesforce)    │   │ (Salesforce)     │
│ Streamable HTTP  │      │  Streamable HTTP │   │ Streamable HTTP  │
└──────────────────┘      └──────────────────┘   └──────────────────┘
```

**Key architectural rules:**
1. The frontend NEVER calls MCP servers directly. The agent loop in `lib/llm/heroku.ts` orchestrates every MCP call.
2. Claude 4.5 Sonnet (via Heroku Inference) sees the MCP tools as flattened OpenAI `function` specs with namespaced names (`salesforce_crm__<tool>`, `data_360__<tool>`, `tableau_next__<tool>`).
3. Tool dispatches happen in parallel when Claude emits multiple `tool_calls` in one turn.
4. Every MCP call emits a `tool_use` + `tool_result` SSE event — that's the reasoning trail the UI renders.

---

## 4. Project Structure

```
horizon/
├── CLAUDE.md                    # This file
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json                # strict: true, noUncheckedIndexedAccess: true
├── tailwind.config.ts
├── postcss.config.js
├── .env.local.example
├── .cursorrules                 # Symlink or pointer to CLAUDE.md
├── Procfile                     # web: npm start
│
├── app/
│   ├── layout.tsx               # Root layout, theme provider, fonts
│   ├── page.tsx                 # Horizon — THE home page (and the whole app)
│   ├── globals.css
│   ├── api/
│   │   ├── brief/
│   │   │   └── route.ts         # POST — generate morning brief (SSE)
│   │   ├── ask/
│   │   │   └── route.ts         # POST — Ask Anything endpoint (SSE)
│   │   ├── priority/
│   │   │   └── route.ts         # GET — priority queue
│   │   ├── actions/
│   │   │   └── route.ts         # POST — execute a pre-drafted action
│   │   ├── signals/
│   │   │   └── route.ts         # GET — live signal feed (SSE)
│   │   └── auth/
│   │       └── salesforce/
│   │           ├── login/route.ts
│   │           └── callback/route.ts
│   └── slack/
│       └── page.tsx             # Slack-surface demo (stretch)
│
├── components/
│   ├── horizon/
│   │   ├── MorningBrief.tsx
│   │   ├── PriorityQueue.tsx
│   │   ├── PortfolioPulse.tsx
│   │   ├── PreDraftedActions.tsx
│   │   ├── AskBar.tsx           # Floating, always-present
│   │   ├── SignalFeed.tsx
│   │   ├── ClientDetailSheet.tsx
│   │   └── ReasoningTrail.tsx   # The transparent "agent work" panel
│   ├── ui/                      # shadcn components
│   └── brand/
│       ├── HorizonMark.tsx
│       └── tokens.ts            # Color/typography tokens
│
├── lib/
│   ├── anthropic/
│   │   ├── client.ts            # Anthropic SDK wrapper
│   │   ├── mcp-servers.ts       # MCP server config builder
│   │   └── stream.ts            # SSE helpers for streaming
│   ├── prompts/
│   │   ├── system.ts            # Base system prompt (shared)
│   │   ├── morning-brief.ts
│   │   ├── ask-anything.ts
│   │   ├── priority-queue.ts
│   │   └── action-drafting.ts
│   ├── salesforce/
│   │   ├── oauth.ts             # OAuth flow
│   │   └── token.ts             # Token refresh + storage
│   ├── db/
│   │   ├── schema.sql
│   │   └── queries.ts
│   ├── voice.ts                 # Web Speech API wrapper
│   └── utils.ts
│
├── types/
│   ├── horizon.ts               # Domain types (Client, Signal, Action, etc.)
│   └── mcp.ts                   # MCP response typings
│
├── public/
│   ├── fonts/
│   └── seed/                    # Synthetic demo data fixtures
│
└── scripts/
    ├── seed-data-cloud.ts       # Populate synthetic financial services data
    └── verify-mcp.ts            # Smoke test all 3 MCP servers
```

---

## 5. MCP Integration — THE Critical Path

This is where most of the technical novelty lives. Read this section carefully before writing any agent code.

### 5.1 The Pattern

Use the Anthropic Messages API with the `mcp_servers` parameter. Claude will natively call MCP tools — no function-calling glue code required.

```typescript
// lib/anthropic/client.ts
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    "anthropic-beta": "mcp-client-2025-11-20", // current as of Apr 2026
  },
});

export async function ask({
  messages,
  system,
  salesforceToken,
}: {
  messages: Anthropic.MessageParam[];
  system: string;
  salesforceToken: string;
}) {
  return anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system,
    messages,
    mcp_servers: [
      {
        type: "url",
        url: "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
        name: "salesforce_crm",
        authorization_token: salesforceToken,
      },
      {
        type: "url",
        url: "https://api.salesforce.com/platform/mcp/v1/data/data-cloud-queries",
        name: "data_360",
        authorization_token: salesforceToken,
      },
      {
        type: "url",
        url: "https://api.salesforce.com/platform/mcp/v1/analytics/tableau-next",
        name: "tableau_next",
        authorization_token: salesforceToken,
      },
    ],
  });
}
```

### 5.2 Parsing Responses

Response content blocks have different `type` values. Parse by type, never by index:

- `type: "text"` — narrative from Claude
- `type: "mcp_tool_use"` — Claude decided to call an MCP tool (shows the tool + inputs)
- `type: "mcp_tool_result"` — the result came back

```typescript
const toolCalls = response.content
  .filter((b) => b.type === "mcp_tool_use")
  .map((b) => ({
    server: b.server_name,
    tool: b.name,
    input: b.input,
  }));

const narrative = response.content
  .filter((b) => b.type === "text")
  .map((b) => b.text)
  .join("\n");
```

### 5.3 Tool Selection Guidance (put this in the system prompt)

Claude needs to know WHEN to reach for which server. Encode this in prompts:

- **SObject All (`salesforce_crm`)** — use for: "who is this client?", CRM records, tasks, opportunities, contacts, writes/updates, approvals. First-party structured business data.
- **Data 360 (`data_360`)** — use for: transactional patterns, unified profile, behavioral signals, anything requiring SQL across unified sources (transactions, held-aways, digital engagement, life events).
- **Tableau Next (`tableau_next`)** — use for: KPIs, governed metrics, analytical questions ("what drove the change in..."), portfolio performance, segmentation. Prefer `analyze_data` (Analytics Q&A) for open-ended analytical questions.
- **Heroku Toolkit (`heroku_toolkit`)** — use for: stateless computation, document parsing, or custom Heroku-hosted tools. Never the first choice — reach here only when none of the three Salesforce MCPs fit. Currently empty until we deploy custom MCPs.

Rule of thumb for the prompt: **structured business records → SObject. Unified analytical data → Data 360. Governed metrics and narrative analytics → Tableau Next. Stateless enrichment → Heroku Toolkit.**

### 5.4 Streaming

All long-running agent calls must stream. Use Anthropic's `stream: true` + forward events via SSE to the client. The UI renders tokens as they arrive AND renders a live "reasoning trail" panel showing each `mcp_tool_use` event as it fires.

---

## 6. Design System

### 6.1 Aesthetic Direction

Premium fintech. References: Stripe, Arc browser, Linear, Mercury Bank, Ramp. NOT Lightning Experience. NOT Material. NOT Bootstrap.

### 6.2 Tokens

```ts
// components/brand/tokens.ts
export const tokens = {
  colors: {
    // Dark mode (primary)
    bg:        "#0A0B0D",       // near-black, warm
    surface:   "#111316",
    surface2:  "#17191D",
    border:    "#23262B",
    text:      "#F2F3F5",
    textMuted: "#8A8F98",
    accent:    "#5B8DEF",       // calm, trust-forward blue
    accentDim: "#3A5FA8",
    success:   "#4ADE80",
    warn:      "#F5A524",
    danger:    "#F87171",
  },
  font: {
    sans:    '"Inter", system-ui, sans-serif',
    display: '"Söhne", "Inter", sans-serif',   // fallback to Inter if no license
    mono:    '"JetBrains Mono", ui-monospace',
  },
  radius: { sm: "6px", md: "10px", lg: "14px", xl: "20px" },
  motion: {
    easeOut: "cubic-bezier(0.16, 1, 0.3, 1)",
    fast: "140ms",
    med: "280ms",
  },
};
```

### 6.3 Layout Rules

- Single-column, max-width ~920px, centered.
- Generous vertical rhythm: section spacing 64–96px.
- No borders around cards unless absolutely necessary — use subtle bg elevation (`surface` vs `surface2`) for grouping.
- Text hierarchy does the work. Display font only for the briefing and headline metrics.
- Ask Bar is fixed bottom-center, floating, ~640px wide, with a glow on focus.

### 6.4 Motion

- All data entering the DOM fades + slides up 8px over 280ms with `easeOut`.
- Agent reasoning trail items shimmer as they stream in.
- Never spin a spinner. Show streaming tokens, shimmer placeholders, or skeleton bars.

---

## 7. System Prompts — Authoritative Drafts

Keep these in `lib/prompts/`. Treat them like code: versioned, reviewed, tested.

### 7.1 Base System Prompt (shared by all features)

```
You are Horizon, the AI relationship-banking concierge for a Salesforce banker in financial services. You have access to three MCP servers:

- salesforce_crm: CRM records (Accounts, Contacts, Opportunities, Tasks, Cases). Use for structured business data and for any writes/updates/tasks.
- data_360: Unified customer data via SQL (transactions, behavioral signals, held-aways, life events, digital engagement). Use for pattern detection and cross-source analysis.
- tableau_next: Governed semantic models and KPIs with an Analytics Q&A tool (analyze_data). Use for metric questions and narrative analytics.

RULES:
1. Always reach for the right server. Structured business records → salesforce_crm. Unified analytical data → data_360. Governed metrics → tableau_next.
2. Prefer parallel tool calls when questions span sources.
3. Never fabricate data. If an MCP call fails or returns empty, say so and propose a next step.
4. Output should be scannable by a banker in 5 seconds. Lead with the insight, then the evidence.
5. When a client is mentioned by name, resolve to a Salesforce Contact or Account ID before taking further action.
6. Never reveal internal tool names to the end user unless asked. In the UI, the reasoning trail will show the mechanics.
7. For any action that writes data (create task, send email, update record), produce a DRAFT — do not execute. The banker approves.
```

### 7.2 Morning Brief Prompt (sketch)

```
Generate today's morning brief for {banker_name}. It is {localTime} on {dayOfWeek}, {date}.

Produce exactly 3 items that matter TODAY, ranked by importance. For each item:
- One-sentence headline (≤ 18 words)
- One-sentence "why it matters"
- One suggested action

Data to consult (in parallel):
- data_360: transactional anomalies in the last 24h for this banker's book (use the banker's User ID from salesforce_crm.getUserInfo first)
- salesforce_crm: tasks due today, stale accounts (>30 days no activity), opportunities needing attention
- tableau_next: any KPI that breached threshold in the last week for this banker's portfolio

Return structured JSON:
{
  "greeting": "Good morning, {first_name}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?" }
  ],
  "signoff": "One line, slightly personal, time-aware."
}
```

### 7.3 Ask Anything Prompt

```
The banker just asked: "{utterance}"

Decide which MCP servers are needed. Call them in parallel. Synthesize the answer in ≤ 120 words. If the answer implies an action, propose a DRAFT action the banker can approve with one click.

Be direct. Bankers read this between meetings.
```

---

## 8. Build Phases (9-Day Sprint)

| Day | Date    | Deliverable                                                                 | Done-when                                                                 |
|-----|---------|-----------------------------------------------------------------------------|---------------------------------------------------------------------------|
| 1   | Apr 18  | Scaffold + Salesforce OAuth working + all 3 MCPs answering `hello`         | `scripts/verify-mcp.ts` returns clean output for all 3 servers            |
| 2   | Apr 19  | Ask Anything end-to-end (typed only), SSE streaming, reasoning trail       | Type a question, see tokens stream, see MCP tool calls render live       |
| 3   | Apr 20  | Morning Brief generator + narrated playback (Web Speech)                   | Hit home page, brief generates, voice plays, cards render                |
| 4   | Apr 21  | Priority Queue + Client Detail Sheet                                       | Queue ranks clients with reasoning; click → full 360 view                |
| 5   | Apr 22  | Portfolio Pulse (Tableau Next via analyze_data) + Pre-Drafted Actions      | Pulse narrates 2–3 KPIs; actions generate + execute via SObject writes   |
| 6   | Apr 23  | Live Signal Feed + UI polish pass #1                                       | Signals stream in sidebar; app feels premium                             |
| 7   | Apr 24  | Voice input for Ask Bar + UI polish pass #2 + error states                 | Speak a question, get answer; visual design hits "demo-worthy" bar       |
| 8   | Apr 25  | Film demo video (multiple takes)                                            | Raw footage complete; backup takes of every beat                         |
| 9   | Apr 26  | Edit video + buffer + submit Apr 27                                         | Submitted                                                                |

**Stretch (only if ahead of schedule):** Slack surface using Slack Block Kit rendering the same brief.

**Cut order if behind:** Slack surface → Signal Feed → Voice input → Portfolio Pulse detail. Protect the Morning Brief, Ask Anything, Priority Queue, and Pre-Drafted Actions at all costs.

---

## 9. Coding Standards

- **TypeScript strict mode.** `noUncheckedIndexedAccess: true`. No `any` without a `// why:` comment.
- **Server/Client boundary explicit.** Prefer Server Components; mark Client Components with `"use client"` only when needed (state, event handlers, browser APIs).
- **No inline MCP logic in components.** All agent calls go through `lib/anthropic/` helpers.
- **Prompts are data, not code.** Keep them in `lib/prompts/` as exported template functions. Version them.
- **Streaming first.** Any endpoint that calls Claude returns SSE. Never block and return a full JSON body for agent calls.
- **Error handling.** Every MCP failure must degrade gracefully — show a clear message in the reasoning trail, not a silent failure. The banker should always know when a source is down.
- **No console.log in committed code.** Use a tiny logger (`lib/log.ts`) that writes to Heroku logs with correlation IDs.
- **Tailwind only for styling.** No styled-components, no CSS modules, no inline style objects except for dynamic values.
- **Accessibility.** Keyboard nav works everywhere. Focus rings visible. Voice is an *enhancement*, not a requirement.

---

## 10. Environment Variables

```bash
# .env.example

# Anthropic (primary LLM path — required for native mcp_servers)
ANTHROPIC_API_KEY=sk-ant-...

# Salesforce OAuth (External Client App — OAuth 2.1 + PKCE, scope `mcp_api`)
SF_CLIENT_ID=
SF_CLIENT_SECRET=
SF_LOGIN_URL=https://login.salesforce.com
SF_REDIRECT_URI=http://localhost:3000/callback

# Heroku Managed Inference + MCP Toolkit (set automatically by the
# heroku-inference addon on deploy; the toolkit lives at $INFERENCE_URL/mcp/sse
# and is attached as the 4th MCP server when these are present)
INFERENCE_URL=https://us.inference.heroku.com
INFERENCE_KEY=
INFERENCE_MODEL_ID=claude-4-5-sonnet

# Heroku Postgres + Redis (set automatically on deploy)
DATABASE_URL=
REDIS_URL=

# App
APP_URL=http://localhost:3000
NODE_ENV=development

# Banker persona (for demo)
DEMO_BANKER_USER_ID=
DEMO_BANKER_NAME=
```

---

## 11. Demo Requirements — Protect These At All Costs

The video is the submission. If a feature cannot be demonstrated in the video, it does not exist. Every sprint day, ask: "does this improve the video?"

Features that MUST work on video day:
1. Morning Brief renders and narrates on page load (≤ 10 seconds to first token).
2. Ask Anything handles the scripted demo questions (see `docs/demo-script.md` — to be created day 7).
3. Priority Queue shows at least 5 ranked clients with reasoning.
4. One Pre-Drafted Action can be approved and writes back to Salesforce visibly.
5. Reasoning Trail expands and shows actual MCP tool names being called.

If any of these break on day 7, STOP building and fix.

---

## 12. Anti-Patterns — Reject These

- ❌ Building a dashboard. Horizon is not a dashboard.
- ❌ Writing direct REST/GraphQL calls to Salesforce from the frontend. Everything goes through Claude + MCP.
- ❌ Hard-coding demo data. Seed Data 360 with synthetic records and let the agent discover them.
- ❌ Hiding the reasoning trail. It's a differentiator, show it proudly.
- ❌ Long-form agent outputs. Bankers skim. ≤ 120 words unless explicitly asked to expand.
- ❌ Spinners. Use streaming tokens and shimmer instead.
- ❌ Multi-page navigation. If you're tempted to add a route, you're doing it wrong.
- ❌ Mimicking Salesforce Lightning chrome. We are explicitly NOT that.

---

## 13. Working Agreement for Claude (the coding agent)

When I (the developer) give you a task:

1. Read this file first. Always.
2. Propose the smallest change that delivers the outcome. Don't refactor opportunistically.
3. Before writing code that calls Claude or an MCP, confirm which server the data lives in and which tool you'll call.
4. After any change that touches `lib/prompts/`, run a smoke test by calling the affected endpoint with a realistic payload.
5. If you need to add a dependency, explain why in the commit message. Prefer standard library and the existing stack.
6. For UI work, produce screenshots or screen recordings in the PR description.
7. When uncertain between two approaches, surface the choice with a crisp "A or B" — don't guess.

---

## 14. Success Criteria

Horizon wins the contest if, during the 3-minute video:
- A non-technical DAX leader immediately understands what it is.
- The "headless" thesis is visibly evident — no nav, no tabs, no typical Salesforce chrome.
- All three MCP servers are visibly exercised in the reasoning trail.
- There is at least one *uncanny* moment that makes a judge lean forward.
- The closing frame earns the line: **"The conversation is the interface. Welcome to headless banking."**

Everything in this spec is in service of that 3 minutes.

---

*Last updated: April 18, 2026. Owner: Jose. Status: GO.*
