# `app/` — Next.js App Router

[![Next.js](https://img.shields.io/badge/Next.js-15.5-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![App Router](https://img.shields.io/badge/router-app-000000)](https://nextjs.org/docs/app)
[![Server Components](https://img.shields.io/badge/components-server%20%2B%20client-3178c6)](https://nextjs.org/docs/app/building-your-application/rendering/server-components)

The Next.js App Router tree — every route, every API endpoint, the global layout, theming. The browser **never** calls Salesforce MCPs directly; everything goes through one of the API routes here, which delegates to `lib/llm/*` agent loops or `lib/mcp/*` clients.

## Top-level files

| File | Role |
|------|------|
| `layout.tsx` | Root HTML shell. Loads fonts, applies the theme provider, mounts `<body>` and the global stylesheets. Server Component. |
| `globals.css` | Tailwind layers, custom CSS variables (chart palette, surface tokens), keyframe animations. |
| `themes.css` | The 42-theme CSS variable definitions. Toggled via `data-theme="…"` set by `ThemeSwitcher`. |

## Route groups

```
app/
├── (banker)/          ← banker route group: shared chrome + auth
│   ├── layout.tsx        gated layout (signed-out users see SignInBanner)
│   ├── page.tsx          / — Today: morning brief, queue, pulse, drafts, signals, ask bar
│   ├── analyze/
│   │   ├── page.tsx      /analyze — entry, model picker
│   │   └── [modelId]/    /analyze/[modelId] — workbench with Suspense-streamed shell
│   └── ask/
│       ├── page.tsx      /ask — entry + starter prompts
│       └── [threadId]/   /ask/[threadId] — multi-turn conversation
├── api/               ← all server endpoints (see § API routes)
├── callback/          ← /callback — Salesforce OAuth return leg
└── slack/             ← /slack — stretch-stub Slack surface (Block Kit demo placeholder)
```

`(banker)` is a [route group](https://nextjs.org/docs/app/building-your-application/routing/route-groups) — parentheses around the segment make it organize files without contributing to the URL. So `(banker)/page.tsx` serves `/`, `(banker)/ask/page.tsx` serves `/ask`, etc.

## API routes (`app/api/`)

Every API route runs on Node runtime (not Edge). Most stream Server-Sent Events (SSE) — long-running agent calls would never fit in a single JSON response. The streaming protocol is defined in `lib/sse/stream.ts` and consumed client-side by `lib/client/useAgentStream.ts`.

### Today surface
| Route | Method | Purpose |
|-------|--------|---------|
| `brief/` | POST | Morning brief generator (SSE; daily section cache via `lib/sse/sectionCache.ts` — first hit per banker per local-day pays the agent loop, rest replay the captured event sequence; `?refresh=1` bypasses) |
| `arc/` | GET | Today's arc timeline (SSE; same daily section cache + `?refresh=1` bypass) |
| `arc-drag/` | POST | Drag-to-reschedule intent capture |
| `priority/` | GET | Priority queue ranking (SSE; same daily section cache + `?refresh=1` bypass) |
| `pulse/` | GET | Portfolio pulse KPIs (SSE; same daily section cache + `?refresh=1` bypass) |
| `pulse-strip/` | GET | Compact header pulse (SSE; not cached — light query, runs each load) |
| `drafts/` | GET | Pre-drafted action queue (SSE; same daily section cache + `?refresh=1` bypass) |
| `actions/` | POST | Approve+execute a draft to Salesforce |
| `signals/` | GET | Live signal feed (JSON; client polls ~45s; not cached — independent of the section cache) |
| `insights/` | POST | Per-section insight banner (SSE) |
| `ask/` | POST | Ask Anything — open-ended Today query (SSE) |
| `prep/` | POST | "Prep me" per-client briefing (SSE) |
| `client/[id]/` | GET | Client 360° detail sheet (SSE) |

### Analyze surface
| Route | Method | Purpose |
|-------|--------|---------|
| `analyze-models/` | GET | List Tableau Next semantic models from cache |
| `analyze-models/[id]/` | GET | Single SDM profile (server-fetched, fast path) |
| `analyze-models/[id]/metrics/` | GET | Named-metric pills for the model header |
| `analyze-models/[id]/metrics/[metricApiName]/` | GET | Curated + raw definition for governance drawer |
| `analyze-ask/` | POST | Analyze workbench agent loop (SSE) |
| `analyze-followups/` | POST | MiniMax follow-up pill generator |

### Ask My Data surface
| Route | Method | Purpose |
|-------|--------|---------|
| `ask-data/` | POST | Ask My Data agent loop over Data 360 (SSE) |
| `ask-threads/` | GET, POST | List + create Ask My Data threads |
| `ask-threads/[id]/` | DELETE | Delete a thread |
| `ask-threads/[id]/messages/` | GET, POST | Thread message history |

### Auth + admin
| Route | Method | Purpose |
|-------|--------|---------|
| `auth/logout/` | POST | Clear the `hz_sf` cookie |
| `connect/` | GET | Initiate Salesforce OAuth + PKCE handshake |
| `callback/` (top-level) | GET | OAuth return leg; persists token, upserts `scheduler_credentials` |
| `health/` | GET | Liveness probe used by Heroku + smoke tests |
| `admin/refresh-dc-cache/` | GET, POST | Diagnostic + dev-only refresh trigger (auth-gated) |

### Salesforce label / entity helpers
| Route | Method | Purpose |
|-------|--------|---------|
| `sf/labels/` | POST | Resolve user-friendly labels for SF IDs (cached) |
| `sf/entity-by-names/` | POST | Reverse lookup: name → SF ID |
| `tts/` | POST | Optional ElevenLabs TTS proxy (falls back to Web Speech in browser) |

## Conventions

- Every route uses `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` because they all touch cookies / DB / MCP sessions.
- Routes that call agents go through `lib/llm/provider.ts#runAgentWithMcp` (Today), `lib/inference/analyzeAgent.ts` (Analyze), or `lib/inference/askDataAgent.ts` (Ask My Data) — never invoke MCP clients directly.
- `cookies()` and dynamic-route `params` are `await`ed per the Next 15 async-boundary contract.
- SSE responses use `lib/sse/stream.ts#makeSseStream`, which wires proxy-safe headers + banker-facing error mapping.

## Related

- [`docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) — full request flow with Mermaid diagrams.
- [`docs/ARTIFACTS.md`](../docs/ARTIFACTS.md) — UI ↔ API map.
- [`components/README.md`](../components/README.md) — what consumes which API.
