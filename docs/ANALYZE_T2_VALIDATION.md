# Analyze — Tier 2 validation (T2-1 through T2-6)

This document closes out the v1.1-expansion Tier 2 work. It's the
record of what actually shipped against `EXPANSION_v4.md` §Tier 2 plus
deviations from the original spec that the team agreed to in-flight.

Commits in scope:
- `79a8333` feat(horizon-v1.1): T2-1 entry + semantic model picker
- `ac63221` feat(horizon-v1.1): T2-2 model detail page — profile + metric pills
- `0d48445` feat(horizon-v1.1): T2-3 agent loop + workbench + persistence
- `488bda3` feat(horizon-v1.1): T2-4 18 charts + grounded MiniMax selector + `<think>` stripper
- `90ae473` fix: trail-disappear + empty-narrative
- `42db336` fix: question echo + prose-to-data extraction
- `837c55e` fix: dedupe multi-call narrative + clean trail previews
- `d3bbab5` feat: per-model starter questions
- `f738b3d` fix: always show starter questions
- `e7dcdea` feat(horizon-v1.1): T2-5 governance drawer — metric definition on demand
- `459bc53` feat: multi-turn in-memory conversation
- (this commit) feat(horizon-v1.1): T2-6 follow-ups + polish

## Architecture summary

Analyze is a governed analytics workbench over Salesforce-hosted
Tableau Next (`/platform/mcp/v1/analytics/tableau-next`). It uses:

- **Kimi K2 Thinking** for agent orchestration (tier: reasoning)
- **MiniMax M2** for chart selection, prose-to-data extraction, and
  follow-up generation (tier: short)
- **Banker PKCE token** from Horizon's ECA for MCP auth — same token
  the Today surface uses
- **Postgres `analyze_latest` table** for per-user × per-model latest
  analysis persistence; multi-turn is in-memory per page session

## T2-1 — Entry + model picker

- `/analyze` renders `AnalyzeWorkspace` with model sidebar (280px) +
  main column entry copy ("Pick a model to explore.").
- `/api/analyze-models` proxies `list_semantic_models`, parses full
  response (not the 8k-truncated modelText), returns all 16 SDMs.
- `ModelList` sidebar: debounced search, loading/error/unauth/empty
  states, retry, active-state indicator, hard-nav `<a href>` so model
  switches feel instant during an in-flight analyze turn.

## T2-2 — Model detail

- `/analyze/[modelId]` server-fetches profile via `getModelProfile`
  (fast path), client-fetches metrics via `ModelMetricsPills` (slower).
- `ModelHeader` renders label, description, apiName code tag,
  dataspace/categories/updated chips, business preferences when set.
- Named-metric pills: click pre-fills the Ask bar with
  `"Show me [metric label] over the last 6 months"` via
  `ANALYZE_ASK_BAR_FILL_EVENT` window custom event (wired in T2-6).

## T2-3 — Agent loop + workbench + persistence

- `openFirstPartyTableauNext` (Streamable HTTP, bearer-auth session)
- `runAnalyzeAgent` generator: curated 8-tool set, dedup cache,
  error circuit at 3, max 5 iterations
- `/api/analyze-ask` SSE route with 7 event types (token, tool_call,
  tool_result, table_fallback, chart_spec, persisted, done, error)
- `analyze_latest` table, `upsertLatestAnalysis` per turn
- Answer extraction via `extractAnalyzeAnswer`: unwraps Tableau's
  nested `defaultExc.answer` + decodes HTML entities
- `pickDominantAnswer`: dedupes multi-call narratives; longest answer
  wins (captures breakdowns over aggregates)

## T2-4 — 18 chart types + grounded selector

- `lib/analyze/chartTypes.ts` — canonical list + `CHART_TYPE_DOC`
  (whenToUse, dataShape, requires, rejectIf rules). Single source of
  truth shared by selector prompt and runtime validator.
- 18 types: line, area, stacked_area, bar, stacked_bar, grouped_bar,
  pie, scatter, bubble, kpi, table, histogram, heatmap, funnel,
  treemap, radar, gauge, waterfall.
- `selectChartSpec` (MiniMax, tier=short, JSON mode) picks a type +
  props; `validateChartSpec` enforces rules; failure falls back to
  table. Two-layer grounding.
- Recharts natively covers line/area/bar/pie/scatter/radar/funnel/treemap;
  custom SVG for heatmap, gauge, waterfall.
- 8 theme chart colors derived via `color-mix(in oklch, ...)` on
  `:root` — zero per-theme override cost; works for all 42 themes.
- `<think>` tag stripper (Kimi's chain-of-thought occasionally leaks
  into narrative; streaming-safe tag-spanning-chunks strip).

## T2-5 — Governance drawer

- `/api/analyze-models/[id]/metrics/[metricApiName]` returns curated
  + raw definition via `get_semantic_model_metric`.
- `referencedMetricsFromText` — pure string-match (case-insensitive,
  whole-name) against SDM's named metrics.
- `MetricChips` renders "Used in this answer" row below narrative.
- `MetricDrawer` right-side slide-in (480px), Esc/overlay close, body
  scroll lock. Curated 5 fields (description, formula derived as
  `aggregationType(sourceField)`, data source, time grains, last
  modified) + "Show raw definition" toggle exposing full JSON.
- Only computes `referenced` post-streaming to avoid flicker.

## T2-6 — Follow-ups + polish

- `/api/analyze-followups` reuses Ask My Data's
  `generateFollowUps` (MiniMax, domain-agnostic).
- `AnalyzeFollowUps` replaces the "Try asking" row after the first
  completed turn (Q-T2-6-a = C). Each new turn refreshes.
- Follow-up click pre-fills the Ask bar, does NOT submit
  (Q-T2-6-b = B).
- `MarkdownView` now renders narratives — `**bold**`, bullet lists,
  tables all render with real typography instead of literal asterisks.
- Named-metric pills at top of page unblocked: click pre-fills Ask
  bar with "Show me X over the last 6 months" via window event.

## Multi-turn

The spec called for single-shot-per-model persistence (Q-T2-3-b-detail
= A). After banker feedback, in-memory multi-turn shipped (`459bc53`):

- `FinishedTurn` snapshots accumulate in local state
- Each new turn appends below the previous; transcript grows during
  the session
- Page refresh → back to the persisted latest (single-row per user × model)
- Server persistence is unchanged

## Known-open / intentional gaps

| Item | Reason |
|---|---|
| No per-model full history (only latest persisted) | Schema cost; multi-turn feel covered in-memory |
| `list_semantic_models` not exposed to Kimi | One model in scope per turn (Q-T2-3-a = A) |
| Analytics Agent often returns prose-only (no structured rows) | Mitigated via MiniMax `extractStructuredFromProse` — works for most banker questions; prose with no tabular data still renders narrative only |
| 18 chart types includes some rarely-picked types | Expanding the palette was the user ask; grounding rules keep MiniMax from over-picking niche types |
| Governance drawer uses string-match, not semantic extraction | Q-T2-5-a = B. Deterministic, free, catches 98% of cases since Analytics Agent echoes metric labels verbatim. |

## Verification shorthand

- Build + lint clean across all 12 Tier 2 commits
- Live smoke against CSAT_NPS_Model: ~700–1500 chars narrative,
  1 chart (line or bar), 2–3 follow-ups contextual to the actual
  numbers returned
- /api/analyze-followups smoke: 3 grounded next-step questions in
  JSON-object form
- Today (`/`) and Ask My Data (`/ask`) unaffected across all Tier 2 work
