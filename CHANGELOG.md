# Changelog

All notable changes to Horizon are recorded here.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The project does not tag formal semver releases — date-anchored sections are the unit of release, matching the deploy cadence on Heroku (`headless-jdo`). For deeper context on any entry, see the **Recent milestones** log in [`docs/README.md`](docs/README.md) and the relevant spec under [`docs/superpowers/specs/`](docs/superpowers/specs/).

Entries are written for engineering reviewers — bullets describe what shipped at a level a contributor needs to triage a regression. Banker-visible product copy lives in [`README.md`](README.md).

---

## [Unreleased]

Nothing pending — `main` is what's deployed.

---

## [2026-05-12] — Mobile responsive Phase 0 + Next 15.5.18

### Added
- **Mobile drawer primitive** — new `components/horizon/mobile/MobileDrawer.tsx` (focus-trap, Esc, body scroll-lock, backdrop tap, `lg:hidden`). Single shared component used by both `/analyze` (model picker) and `/ask` (thread picker).
- **Mobile sidebar wrappers** — new `components/analyze/AnalyzeMobileSidebar.tsx` and `components/ask-data/AskMobileSidebar.tsx` render a "Browse models" / "Threads" trigger button on phones and host the existing `<ModelList />` / `<ThreadList />` inside the drawer unchanged.
- **Mobile section nav** — `components/horizon/mobile/MobileNav.tsx` rewritten as a 3-icon section nav (Today / Ask / Analyze) mirroring `LeftRail` and mounted globally in `app/(banker)/layout.tsx` so all three surfaces have nav on phones.
- **`slide-in-left` Tailwind keyframe** mirroring the existing `slide-in-right`.
- **Spec doc** — [`docs/superpowers/specs/2026-05-12-mobile-responsive-design.md`](docs/superpowers/specs/2026-05-12-mobile-responsive-design.md).

### Changed
- **Desktop `LeftRail` gated to `lg+`** — `app/(banker)/layout.tsx` wraps `LeftRail` in `hidden lg:contents` and switches `pl-16` → `lg:pl-16`. Phones reclaim 64 px (~17 % of a 375 px viewport).
- **`ModelList.tsx` and `ThreadList.tsx`** — added optional `onSelect` callback so the drawer can close after navigation.
- **`AnalyzeEntry.tsx` empty-state copy** — no longer references a non-existent sidebar on mobile.
- **`HorizonSignedIn.tsx`** — removed redundant `MobileNav` mount (now mounted in the layout for all banker routes).

### Security
- **Bumped `next` 15.5.15 → 15.5.18** — closes 13 GHSA advisories: SSRF via WebSocket upgrades (CVSS 8.6), middleware/proxy bypass via dynamic route param injection (8.1), middleware bypass via segment-prefetch + i18n (7.5×3), DoS via Server Components / Cache Components / Image Optimization, XSS in `beforeInteractive` scripts + CSP-nonce App Router, RSC cache poisoning, middleware redirect cache poisoning. `eslint-config-next` lockstep bumped.
- 6 transitive `npm audit` alerts remain (mcp-sdk → `hono`/`fast-uri`/`ip-address`/`express-rate-limit`, plus Next-vendored `postcss`). All gated on upstream releases. None runtime-reachable: this app uses only mcp-sdk's `/client/` exports (not the server scaffolding where those CVEs land), and `postcss` runs at build time only.

---

## [2026-05-08] — Daily section cache + Tableau scope + SOQL `NOW()` ban

### Added
- **Daily section snapshot cache** for the 5 expensive Today routes (`/api/{brief,priority,pulse,drafts,arc}`). New `lib/sse/sectionCache.ts` and `makeCacheableSseStream` helper — first hit per banker per local-day pays the agent loop, subsequent loads replay the captured SSE event sequence so reasoning trail + inference badge survive. 36 h Redis TTL. `?refresh=1` bypasses; "Refresh today" entry in `UserMenu.tsx` fans out all 5 `HORIZON_REFRESH_*` events.

### Changed
- **Tableau `analyze_data` scope** — removed from `morning-brief`, `priority-queue`, `arc` prompts. Pulse-only on Today now (saves 10–40 s per section, removes upstream timeout risk). The "three first-party Salesforce MCPs" story is preserved through Pulse + the Ask Bar.
- **`SYSTEM_PROMPT_VERSION` v1.6.1** with §B.8 forbidding SQL functions in SOQL (`NOW()`, `CURRENT_TIMESTAMP`, `GETDATE()`, `SYSDATE`).
- **`PULSE_STRIP_PROMPT_VERSION` v1.3.2** removed the `StartDateTime >= NOW()` directive that was causing `MALFORMED_QUERY: unexpected token: NOW`.

### Fixed
- `MALFORMED_QUERY` on `salesforce_crm.soqlQuery` for SQL-style functions — `preflightSalesforceSoql` now intercepts these before dispatch with an actionable correction.
- SSE controller hardening — `makeCacheableSseStream` guards every `controller.enqueue` / `close` against client tear-down and only persists complete narratives (writer not thrown AND controller not canceled AND ≥1 `text_delta` AND captured array non-empty).

---

## [2026-05-07] — Demo-day hardening + UX polish

### Added
- **Voice dictation mic on `AnalyzeBar`** — Web Speech API, mirrors `AskBar` / `AskDataBar`.
- **`SectionRail`** — left-edge scroll-spy for the 5 main column sections at `xl+`. Connected dots + inline labels; observes `data-horizon-overlay` via `MutationObserver` and fades out while a `ClientDetailSheet` is open.
- **Client Detail session cache** — `lib/client/clientDetailCache.ts` snapshots the 360° narrative + reasoning trail in `sessionStorage` keyed by `clientId`. First open ~10 s; reopens during the same session are instant. Cleared on sign-out.

### Changed
- **Today-path Tableau timeout** 25 s → 40 s. Every Today route streams SSE from first byte so the H12 idle timer doesn't apply — the cap is a wedged-call backstop.
- **Pulse + Drafts** emit verbatim DC SQL against `Financial_Transactions_Snow_XL__dll` with column names quoted from the cached catalog and a pinned `TIMESTAMP '2024-06-01 00:00:00 UTC'` cutoff (the demo org's transaction stream ends 2026-06-30; relative `CURRENT_DATE` filters returned zero rows).
- **Pulse Tableau analyze** pinned to `Financial_Accounts` SDM with utterance `"Total Current_Balance across Deposits"`.
- **Analyze surface** stops replaying the persisted last analysis on every visit (DB write path retained for audit, just no read-back).
- **Section labels** bumped to 13 px semibold + bright text; **Ask Bar** input + result panel mixed +6 % white via `color-mix(in oklab, …)` so they pop off dark themes.

---

## [2026-05-06] — Scheduler self-heal + SDM apiName preflight + UI chrome

### Added
- **`scheduler_credentials` Postgres singleton** — every `/callback` upserts the banker's `refresh_token`, so unattended scheduler dynos can mint fresh access tokens via `scripts/lib/resolveSfToken.ts` (env → config var → DB row priority).
- **Tableau SDM apiName preflight** in `lib/llm/heroku.ts` — rejects unknown apiNames before the network call when the SDM cache is preloaded; surfaces the real list of valid apiNames in the rejection's `instruction` field.
- **`/api/admin/refresh-dc-cache`** diagnostic now exposes `tableau.cached`, `tableau.survivingSdms`, and `tableau.apiNames` — the full list of SDMs visible to the model.

### Changed
- **`tsx`** moved from `devDependencies` → `dependencies` so post-build slugs include it for scheduler dynos.
- **`SYSTEM_PROMPT_VERSION` v1.6.0** — explicitly forbids owner-user pivots on Data Cloud DMOs (`*OwnerUserId*`, `*BankerId*`, etc.); instructs filtering by `accountid__c` using the account list returned from `salesforce_crm`.
- **Today-path Tableau timeout** 20 s → 25 s.
- **Circuit breaker** — `INVALID_INPUT` and "don't have access" added to `TRIP_ERROR_PATTERNS`; threshold tightened to 2 strikes.
- **UI chrome** — unified `bg-surface` panels across all home-page sections; bold centered section titles on `/`, `/ask`, `/analyze`.

### Fixed
- Scheduler refresh jobs were silently failing because (a) the post-build slug couldn't run them and (b) they required a banker `SF_ACCESS_TOKEN` env var the scheduler dyno can't have. Both addressed by the changes above.
- Hallucinated tool names (e.g. `$MCP_SERVER_DATA_360__get_dc_metadata`) — dispatcher now rejects synthetic names with `isSyntheticGuard: true` so the breaker doesn't trip on infrastructure-unrelated rejects.

---

## [2026-05-05] — Agent loop hardening + `defaultExc` unwrap

### Fixed
- **`defaultExc` envelope unwrap** at both MCP wrapper boundaries (`lib/mcp/client.ts` and `lib/mcp/firstPartyDataCloud.ts`). Every successful `post_dc_query_sql` was being wrapped in a `{"defaultExc": "<stringified JSON>"}` envelope that Kimi misread as "empty results." Latent since 2026-04-30 (Path C).
- **Turn-wide tool-result dedup cache** — identical tool calls within a single `runAgent` invocation are deduplicated across ALL iterations (regressed once; re-fixed in `998def7`).
- **`<think>`-tag streaming stripper** for Kimi's chain-of-thought leaks. Streaming-safe across chunk boundaries.

### Changed
- **Visualization follow-up tool-choice forcing** in Analyze — regex detects pronouns / chart-shape verbs / drill-downs and sets `tool_choice: {type: "function", function: {name: "analyze_data"}}` on iteration 1 so Kimi can't answer "it's already rendered" in prose.
- **Ask My Data** — Markdown rendering, preloaded DC catalog with wider field caps (`fullFieldsTopCount: 40`), pinned-DMO inclusion list.

### Added
- **Turn-wide budget on `analyze_data`** so Analyze can't burn the entire iteration cap on chart re-rolls.
- **Synthetic-guard breaker shield** — synthetic rejections (hallucinated tool names, schema-mismatch preflights) carry `isSyntheticGuard: true` so they don't trip the circuit breaker, which exists for infrastructure failures.
- **Dev-friendly admin refresh route** at `/api/admin/refresh-dc-cache` — `?run=1&tool=dc|tableau|both&force=1` from an authenticated browser tab spawns the refresh script with the banker's live session token, no `SF_ACCESS_TOKEN` plumbing.

---

## [2026-05-04] — v1.1 Tier 2 — Analyze surface

### Added
- **`/analyze` and `/analyze/[modelId]`** — governed analytics workbench over Tableau Next semantic data models.
- **18 chart types** (line, area, bar incl. stacked/grouped, pie, scatter, bubble, KPI, table, histogram, heatmap, funnel, treemap, radar, gauge, waterfall) — Recharts covers most; custom SVG for heatmap / gauge / waterfall. Unified 8-slot palette in `lib/analyze/chartTheme.ts`.
- **Grounded MiniMax chart selector** — picks chart type from a typed allow-list, never invents.
- **Per-model starter questions**, **named-metric pills**, **clickable metric chips** in the workbench.
- **Governance drawer** (T2-5) — slide-in from the right, surfaces curated + raw metric definitions on demand.
- **Multi-turn in-memory conversation** within a single workbench session.
- **Follow-up pills** under the latest answer (MiniMax-generated).
- **Three-agent-loop architecture** — Today (Claude), Analyze (Kimi), Ask My Data (Kimi) all share patterns but not code (`lib/llm/heroku.ts`, `lib/inference/{analyzeAgent,askDataAgent}.ts`).
- **Inference tier router** — `lib/inference/heroku.ts` routes between Claude (reasoning), Kimi (reasoning), MiniMax (short).

### Changed
- **`ANALYZE_PROMPT_VERSION` v0.5.0** — call budget (one `analyze_data` per turn), forbidden-phrase block, follow-up mandate.

See [`docs/ANALYZE_T2_VALIDATION.md`](docs/ANALYZE_T2_VALIDATION.md) for the close-out validation.

---

## [2026-05-03] — v1.1 Tier 1 — Ask My Data — Path C

### Added
- **`/ask` and `/ask/[threadId]`** — multi-turn exploratory SQL agent over Data Cloud.
- **Persisted thread history** in Postgres (`lib/db/askThreads.ts`); `ThreadList` sidebar grouped by recency (Today / Yesterday / This week / Earlier).
- **Reasoning trail + follow-up pills** as a fixed surface inside `/ask`.

### Changed
- **`data_360` MCP** swapped to the first-party `/platform/mcp/v1/data/data-cloud-queries` endpoint (Path C).
- **`tableau_next` MCP** swapped to first-party `/platform/mcp/v1/analytics/tableau-next` endpoint.
- **Anthropic-direct LLM fallback retired.** Everything runs on Heroku Inference now.

### Fixed
- **Tool-name acceptance** — both snake_case and camelCase accepted for graceful first-party transition.

See [`docs/ASK_MY_DATA_T1_VALIDATION.md`](docs/ASK_MY_DATA_T1_VALIDATION.md).

---

## [2026-05-02] — v1.1 Tier 0 — Shared chrome

### Added
- **Persistent left navigation rail** (`components/nav/LeftRail.tsx`) with `⌘1` / `⌘2` / `⌘3` shortcuts.
- **Shared `SectionTopBar`** for `/ask` and `/analyze` — sticky, blurred, centered bold title; mirrors Today's signed-in header shape.
- **Heroku Inference clients for Kimi K2 Thinking and MiniMax M2** alongside the existing Claude client.

---

## [2026-05-01] — Metadata cache layer

### Added
- **DC DMO catalog cache** (`scripts/refresh-dc-metadata.ts` + `lib/llm/dcMetadataCache.ts`) — Heroku Scheduler refreshes ~600 surviving DMOs into Redis hourly; reader injects into the system prompt every turn. **Internal skip gate** via `DC_METADATA_MIN_AGE_HOURS` (default 12) so real work happens ~twice a day.
- **Tableau SDM catalog cache** (`scripts/refresh-tableau-sdms.ts` + `lib/llm/tableauSemanticCache.ts`) — daily refresh; ~8 banker-relevant SDMs.
- **Tool-list filtering** — when caches are warm, `get_dc_metadata` and `list_semantic_models` are stripped from the model's OpenAI function list. The catalog in the system prompt replaces them.
- **Hallucinated tool name rejection** at dispatch. Synthetic names (e.g. `$MCP_SERVER_DATA_360__get_dc_metadata`) are rejected before any network call.
- **Pinned DMO inclusion list** — life-event DMOs always land in the catalog regardless of rowCount ranking.

### Changed
- **Cache TTLs** — DC 25 h, Tableau 26 h. Both sized to tolerate one fully-missed scheduler run.

---

## [2026-04-30] — Path C foundation

### Changed
- **Next 14.2.35 → 15.5.15** — clears 4 high-severity CVEs; includes the App Router async-boundary migration (`cookies()`, dynamic `params` are now `await`ed).
- **MCP servers** swapped to first-party Salesforce-hosted endpoints (`/platform/mcp/v1/{platform/sobject-all,data/data-cloud-queries,analytics/tableau-next}`).
- **OAuth scope** added `cdp_api` so the Data Cloud MCP becomes visible to the bearer token (without it `list_tools` returns 0 tools).
- **Per-tool MCP timeouts** (8 s SOQL / 10 s DC SQL / 25 s Tableau analyze / 15 s metadata).
- **Tool name handling** — accept both snake_case and camelCase from MCP servers during the transition.

### Removed
- **Anthropic-direct LLM path retired** — `@anthropic-ai/sdk` is no longer a dependency.
- **Custom self-hosted MCP** for `data_360` and `tableau_next`.

---

## [2026-04-22] — Morning Brief life events + JSON resilience

### Added
- **Life events hierarchy** in Morning Brief (FSC `PersonLifeEvent` queries) with a "Recent life events" UI block always visible.

### Fixed
- **JSON recovery** across `/api/{brief,pulse,arc,signals}` — lenient parse + retry UI + defensive string coercion before `.trim()` / `.slice()`. Stops client crashes on malformed agent JSON.
- **`PersonLifeEvent` SOQL** — corrected query shape; always render the life events block even when empty.

---

## [2026-04-21] — Theme system + UI polish

### Added
- **42-theme palette** with `data-theme="…"` attribute switching; `ThemeSwitcher.tsx` portals its sheet to `document.body` to escape header stacking contexts.
- **Theme-aware page glow** and morning sheen on light themes.
- **Inline action drafted-from-Ask** flow — `/api/actions` executes approved drafts to Salesforce.
- **Followups** in Ask Bar — contextual suggestions after each turn.
- **Section Insights** — batched single-agent run instead of one per section.
- **Cumulus branding** + Salesforce record link probing for inline IDs.

### Changed
- **Heroku Inference primary routing** — Claude 4.5 Sonnet primary, Kimi K2 Thinking via `HEROKU_INFERENCE_ONYX_*` as optional fallback.
- **Stagger** added across SSE streams (`agentStartStagger.ts`) to avoid Heroku 503 bursts at page load.

### Fixed
- **Schema-grounded preflight for `data_360` SQL** — rejects guessed `*Id__c` columns with closest-match suggestions.
- **`getDcMetadata` not truncated** + broadened `ssot__` namespace guard.
- **Metadata-before-SQL gate** for Data Cloud — model can't issue SQL until it has called metadata in the same turn.
- **Tableau semantic model binding gate** — preflight rejects invented apiNames (`Sales_Analytics`, `Service_Pipeline`).

---

## [2026-04-20] — Day 5–7 sprint — Drafts, 360° sheet, Voice, Themes

### Added
- **Pre-drafted actions** queue with Approve→Execute handshake to Salesforce.
- **Client 360° detail sheet** (`ClientDetailSheet.tsx`) — slide-in right panel; streams from `/api/client/[id]`.
- **Live signal feed** (`SignalFeed.tsx`) — JSON-polled every 45 s.
- **Voice I/O** — Web Speech for input + synthesis; optional ElevenLabs TTS proxy via `/api/tts` with Redis-backed MP3 cache.
- **Multi-turn Ask thread** with sessionStorage persistence + tool-call history.
- **`v3` foundation** — themes, Cumulus brand, SF record links, arc lookahead.

### Changed
- **Schema-mismatch circuit breaker** — 1-strike trip; aggregated repeat errors render as amber in the reasoning trail.
- **OAuth callback** — derived from public origin, not request URL (fixes phishing-flagged path).

---

## [2026-04-18] — Initial commit

### Added
- **Horizon scaffold** — Next.js 14 App Router + Tailwind + shadcn-style UI on Heroku.
- **Today surface** — Morning Brief, Priority Queue, Portfolio Pulse, Pre-Drafted Actions, Live Signals, Ask Bar.
- **Three-MCP agent loop** (`lib/llm/heroku.ts`) against Salesforce CRM + Data 360 + Tableau Next + optional Heroku toolkit.
- **Salesforce OAuth 2.1 + PKCE** with `mcp_api` scope.
- **CLAUDE.md** as authoritative product spec (gitignored — local-only).
- **MCP hygiene guardrails** — schema-grounded preflight, banker-safe error mapping, reasoning-trail rendering.

---

## Conventions for editing this file

- One section per noteworthy ship date. Date format: `[YYYY-MM-DD]`.
- Group entries under **Added / Changed / Fixed / Security / Removed** (Keep-a-Changelog).
- Reference the deeper write-up in `docs/README.md` ("Recent milestones") and the spec under `docs/superpowers/specs/` for context — this file is the at-a-glance index.
- New entries land at the top, under `[Unreleased]` if not yet deployed, or under a new dated section once shipped to Heroku.
- Bump prompt versions and link them; reviewers grep here when triaging reasoning-trail regressions.
