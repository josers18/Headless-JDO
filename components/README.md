# `components/` — UI

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-06b6d4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Recharts](https://img.shields.io/badge/Recharts-3.8-3a8fe8)](https://recharts.org/)

Every UI surface in Horizon. Tree organized by feature area, not by primitive — there is no "atoms / molecules / organisms" — because each surface has its own internal vocabulary (`PulseTile`, `ArcNode`, `ChartRenderer`) and lifting those into a generic library would obscure the product semantics.

> **Aesthetic direction:** premium fintech. Stripe / Arc / Linear / Mercury references — explicitly NOT Lightning Experience. Typography-driven, generous whitespace, subtle motion (8px fade-rise, 280ms easeOut), unified `bg-surface` panels with `border-border-soft`. Tokens live in `brand/tokens.ts`.

## Structure

```
components/
├── horizon/        Today surface — morning brief, queue, pulse, drafts, signals, ask bar
├── analyze/        /analyze workbench — model picker, charts, metric drawer
│   └── charts/     18 chart types (Recharts + custom SVG for niche shapes)
├── ask-data/       /ask multi-turn agent — conversation, thread sidebar, follow-ups rail
├── nav/            Shared chrome — SectionTopBar (centered title), LeftRail, NavCircle
├── brand/          HorizonMark logo + design tokens (colors, fonts, motion)
└── ui/             (currently empty) reserved for shadcn-style primitives if extracted
```

## `horizon/` — Today surface

The five protected surfaces from the contest spec, plus shared chrome.

### Section components (load order on `/`)

| Component | Surface | API |
|-----------|---------|-----|
| `MorningBrief.tsx` | "Right now" hero + "Recent life events" + signoff + older backlog | `POST /api/brief` (SSE) |
| `TodaysArc.tsx` | Timeline of today's nodes + "wrapping up" end-of-day state | `GET /api/arc` (SSE) |
| `PriorityQueue.tsx` | Today / This week / Watch tiered groups; clickable rows → 360° sheet | `GET /api/priority` (SSE) |
| `PortfolioPulse.tsx` | 2–3 KPIs + narrated playback (Web Speech) | `GET /api/pulse` (SSE) |
| `PreDraftedActions.tsx` | Drafts queue with Approve→Execute handshake | `GET /api/drafts` + `POST /api/actions` |
| `SignalFeed.tsx` | Live signal feed; right-rail at ≥1280px, inline below | `GET /api/signals` (polled) |

### Persistent chrome / floating UI

| Component | Role |
|-----------|------|
| `AskBar.tsx` | Fixed-bottom Ask Horizon input — typed + voice + drafted-action picker. Posts to `/api/ask` (SSE). Background mixed +6% white via `color-mix(in oklab, …)` so the bar reads as elevated against the dark page. |
| `SectionRail.tsx` | Left-edge scroll-spy at xl+. Connected dots + inline labels for the 5 main-column sections (Brief, Arc, Priority, Pulse, Drafts — Live Signals lives in the right-rail and is intentionally not on the rail). Active dot is full-bright with a halo, passed dots are mid-faint, upcoming dots are deeply faint. Click any dot to smooth-scroll. Watches the DOM for `[data-horizon-overlay]` via `MutationObserver` and fades out while a sheet is open. |
| `PulseStrip.tsx` | Compact KPI strip in the sticky header (signed-in only). |
| `HeaderClock.tsx` | Live wall-clock + day-of-week in header. |
| `UserMenu.tsx` | Banker name / email dropdown; sign-out (also clears the Client Detail session cache). |
| `ThemeSwitcher.tsx` | 42-theme palette switcher (`data-theme="…"`). |
| `SectionInsight.tsx` | The narrow info banner that sits above each section (`InsightsBatchProvider` batches the agent calls). |
| `ReasoningTrail.tsx` | Collapsible MCP-tool-call trace; rendered inside every agent section. |
| `AgentLog.tsx` | Foot-of-page log of approve/dismiss actions taken this session. |

### Detail / overlay components

| Component | Role |
|-----------|------|
| `ClientDetailSheet.tsx` | Right-side slide-in 360° client view (Esc closes). Streams from `/api/client/[id]` on first open; on reopen during the same session, hydrates synchronously from `lib/client/clientDetailCache.ts` (`sessionStorage`). Renders `data-horizon-overlay="client-detail"` on the backdrop so chrome like `SectionRail` can observe and fade out while it's open. |
| `DraftActionCard.tsx` | One draft row with three-state status (idle / pending / executed). |
| `PulseTile.tsx` | One KPI tile inside Portfolio Pulse, with delta + explanation popover. |
| `ArcNode.tsx`, `ArcTimeline.tsx` | Timeline rendering for Today's Arc. |
| `MarkdownView.tsx` | Shared GFM-rendered narrative (tables / bold / bullets) with `rehype-sanitize`. |
| `BriefRichText.tsx` | Inline-link Salesforce IDs and probed names inside narrative copy. |
| `TextWithSalesforceIds.tsx` | Renders raw text with SF IDs auto-linked to record sheet. |
| `InferenceModelBadge.tsx` | "via Claude / Kimi / MiniMax" badge in section headers. |
| `GhostPrompt.tsx` | Pre-fill suggestions that drop a question into the AskBar. |
| `PrepBriefingPanel.tsx` | "Prep me" per-client briefing rendered inside the ClientDetailSheet. |
| `mobile/MobileNav.tsx` | Bottom-nav for narrow viewports. |

### Provider / context components

| Component | Role |
|-----------|------|
| `HorizonSignedIn.tsx` | Wraps the signed-in tree; lifts banker name into context for child agents. |
| `DraftsContext.tsx` | Single SSE stream → many `DraftActionCard`s. Avoids N stream subscriptions. |
| `InsightsBatchProvider.tsx` | Batches `SectionInsight` requests so we make one MiniMax call per page load. |
| `SectionContentPresence.tsx` | Cross-component "did this section actually fill in?" signal — gates pessimistic insight copy. |
| `SfInstanceProvider.tsx` | Surfaces `instance_url` to deep-link components without prop-drilling. |

### Mode / state components

| Component | Role |
|-----------|------|
| `SignInBanner.tsx` | Signed-out hero with "Sign in to Salesforce" CTA. |
| `InstitutionDemoMode.tsx` | Top-right "demo bank" badge; stays in stealth on prod. |
| `PullToRefresh.tsx` | iOS-style pull-down on mobile to refresh the section. |

## `analyze/` — Analyze workbench

```
analyze/
├── AnalyzeWorkspace.tsx      3-column shell: model sidebar | main column | (no right rail)
├── AnalyzeWorkbench.tsx      Main column — model header + Ask bar + transcript
├── AnalyzeEntry.tsx          /analyze entry state ("Pick a model to explore")
├── AnalyzeBar.tsx            Per-model Ask bar
├── AnalyzeFollowUps.tsx      MiniMax-generated follow-up pills under the latest answer
├── AnalyzeTable.tsx          Tabular fallback when chart selection rejects the spec
├── BusinessPreferencesPanel.tsx   Collapsed-by-default SDM author hints
├── ChartRenderer.tsx         Routes a chart spec to one of charts/<Type>View.tsx
├── MetricChips.tsx           "Used in this answer" row above the narrative
├── MetricDrawer.tsx          Right-side governance drawer — curated + raw metric definition
├── ModelHeader.tsx           Profile + named-metric pills (clickable → AskBar fill)
├── ModelList.tsx             Sidebar with debounced search + active state
├── ModelMetricsPills.tsx     Client-side fetch of the model's metrics
├── StarterQuestions.tsx      Per-model starter questions (always shown)
├── analyzeEvents.ts          Window-event names for cross-component signaling
└── charts/                   18 chart types — line, area, bar (incl. stacked/grouped),
                              pie, scatter, bubble, KPI, table, histogram, heatmap,
                              funnel, treemap, radar, gauge, waterfall.
                              Recharts covers most; custom SVG for heatmap/gauge/waterfall.
                              chartTheme.ts maps the unified 8-slot palette.
```

The full agent loop lives in `lib/inference/analyzeAgent.ts`. The page shell streams via Suspense (`/analyze/[modelId]/page.tsx`).

## `ask-data/` — Ask My Data

```
ask-data/
├── AskWorkspace.tsx          3-column responsive shell
├── AskDataEntry.tsx          /ask entry state with starter prompts
├── AskDataBar.tsx            Visual-chrome-only pill (no Today event bus)
├── Conversation.tsx          Multi-turn message list with MarkdownView rendering
├── ContextRail.tsx           Right rail with live MiniMax follow-ups + memory cues
├── AskDataTrace.tsx          Collapsible reasoning trail
├── ThreadList.tsx            Sidebar grouped by recency (Today / Yesterday / This week / Earlier)
├── StarterPrompts.tsx        6 static starter prompts for the empty state
├── askDataEvents.ts          Shared custom-event names
└── followUpsBus.ts           Module-scoped pub/sub for follow-up pill data
```

Agent loop in `lib/inference/askDataAgent.ts`; threads persist via `lib/db/askThreads.ts`.

## `nav/` — Shared chrome

| Component | Role |
|-----------|------|
| `SectionTopBar.tsx` | Sticky header for `/ask` and `/analyze` — 3-col grid: HorizonMark / centered bold title / theme + clock + user menu. Same shape as Today's signed-in header. |
| `LeftRail.tsx` | Vertical nav strip used in some larger viewports. |
| `NavCircle.tsx` | Pill-style nav anchor used in the LeftRail and tablet layouts. |

## `brand/` — Tokens + logo

| File | Role |
|------|------|
| `HorizonMark.tsx` | The wordmark / logo SVG. Renders in every header. |
| `tokens.ts` | Color tokens (`bg`, `surface`, `surface2`, `border`, `text`, `accent`, …), font stacks, radius scale, motion timings. The single source of truth for the design system; Tailwind classes pull from `tailwind.config.ts` which references these tokens. |

## `ui/` — Reserved

Currently empty. shadcn-style primitives (Button, Dialog, etc.) would land here if we extract any. Today, surface-specific buttons live with their owning component.

## Conventions

- Mark Client Components with `"use client"` only when state, event handlers, or browser APIs are needed. Default is Server Component.
- Tailwind only for styling — no CSS modules, no styled-components, no inline `style` except for dynamic values.
- Premium fintech aesthetic: solid `bg-surface` + `border-border-soft` panels, no spinners (use `shimmer` placeholder or streaming tokens), motion via the design tokens.
- Section-specific components own their own loading + error states. Spinner-free everywhere — section reasoning trails surface MCP failures inline.

## Related

- [`app/README.md`](../app/README.md) — which API each component talks to.
- [`lib/client/README.md`](../lib/client/README.md) — hooks (`useAgentStream`, `useAnalyzeStream`, `useAskDataStream`, theme).
- [`docs/ARTIFACTS.md`](../docs/ARTIFACTS.md) — full UI ↔ API map.
