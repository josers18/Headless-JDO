# Horizon — LLM prompts & agent hygiene

This document is for **humans and coding agents** who change how Horizon talks to Claude (Heroku Inference) and the Salesforce MCPs. The **authoritative runtime text** still lives in TypeScript so it ships with the app and is type-checked; this file explains **where**, **how to edit safely**, and **recorded failure modes** from production reasoning trails.

## Source of truth (runtime)

| File | Role |
|------|------|
| [`lib/prompts/system.ts`](../lib/prompts/system.ts) | Shared **MCP HYGIENE** block for Today: Data Cloud metadata gate, SOQL rules, Tableau semantic binding, universal tone rules. Export: `SYSTEM_PROMPT`, `SYSTEM_PROMPT_VERSION`. |
| [`lib/prompts/ask-anything.ts`](../lib/prompts/ask-anything.ts) | Ask bar (Today): schema discipline, org field allow-lists, output JSON contracts. |
| [`lib/prompts/morning-brief.ts`](../lib/prompts/morning-brief.ts) | Morning brief structure, CRM + Data 360 + Tableau expectations. |
| [`lib/prompts/analyze.ts`](../lib/prompts/analyze.ts) | **Analyze surface** (Kimi + Tableau Next). Current: `ANALYZE_PROMPT_VERSION = v0.5.0`. Call budget (one `analyze_data` per turn), forbidden phrase list, visualization-complete phrasing rules, follow-up mandate. |
| [`lib/prompts/ask-data.ts`](../lib/prompts/ask-data.ts) | **Ask My Data surface** (Kimi + Data 360). Current: `ASK_DATA_PROMPT_VERSION = v0.5.0`. Numbered-option resolution, catalog grounding, no-SQL-in-prose, no-raw-field-names, one-SQL-fix-then-stop, no cross-DMO JOINs, no tutorials. |
| [`lib/prompts/ask-data-followups.ts`](../lib/prompts/ask-data-followups.ts) | MiniMax follow-up pills. Current: `ASK_DATA_FOLLOWUPS_PROMPT_VERSION = v0.3.0`. Returns `{"suggestions":[...]}` to match `response_format: json_object`. |
| Other `lib/prompts/*.ts` | Feature-specific instructions (`prep`, `arc`, `priority-queue`, `signals`, `action-drafting`, etc.). |

**Rule:** Any change to agent behavior that must apply everywhere → extend `system.ts` and **bump `SYSTEM_PROMPT_VERSION`**. Feature-only rules go in the feature prompt and bump that file’s `*_PROMPT_VERSION` constant.

## Why prompts live in TypeScript (not only in Markdown)

- They are **concatenated at runtime** into API requests; a standalone `.md` file is **not** read unless code loads it.
- Version constants give **grep-able** history and PR review (“what changed in v1.5.5?”).
- Optional future step: generate prompt strings from Markdown at **build time** if you want a single prose source — today we optimize for **one shipped source**.

## Recorded failure modes (reasoning trail)

These patterns **actually appeared** in demo runs; `system.ts` §MCP HYGIENE encodes mitigations.

### Data 360 (`data_360`)

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| `unknown column 'AccountId__c'` | Treating DMO SQL like SOQL: inventing `*Id__c` columns. | Only columns **verbatim** in **this turn’s** `getDcMetadata` response for that DMO. Never assume CRM `AccountId` → `AccountId__c` on lakehouse. |
| `unknown column 'ssot__OwnerUserId__c'` (or any owner / banker pivot on a transaction DMO) | Reaching for a CRM-style ownership filter that DC transaction DMOs don't carry at row level. | System prompt v1.6.0+ explicitly forbids `*OwnerUserId*`, `*BankerId*`, etc. on DMOs and instructs filtering by `accountid__c` using the account list returned from `salesforce_crm` (`Account WHERE OwnerId = :user`). Preflight catches the pattern in code regardless. |
| `table … does not exist` / guessed `*__dll` | Inventing DMO developerNames from CRM object names (e.g. `PersonLifeEvent_*__dll`). | `getDcMetadata` first; use exact developerName from response. |
| Second SQL “blocked by schema-mismatch breaker” | Retrying or repeating bad column/table guesses. | One correction path; then accept limitation in narrative. |

### Salesforce CRM (`salesforce_crm` SOQL)

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| `INVALID_FIELD` on `ActivityDate` | Quoted date string, e.g. `ActivityDate < '2024-07-15'`. | **Date** fields: unquoted `YYYY-MM-DD` or date tokens (`TODAY`, `LAST_N_DAYS:30`). |
| `MALFORMED_QUERY` / `unexpected token: 'NEXT_7_DAYS'` | Wrong rolling-window spelling. | Use **`NEXT_N_DAYS:7`**, **`LAST_N_DAYS:30`** (letter `N`, colon, integer). Never `NEXT_7_DAYS` / `LAST_30_DAYS`. |
| `INVALID_FIELD` / `Name` on Task | Task uses `Subject`, not `Name`. | See `system.ts` §B.0. |

### Tableau Next (`tableau_next`)

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| `Semantic model apiName "X" does not exist in this org` (preflight) | Model invented an apiName (e.g. `Sales_Analytics`, `Service_Pipeline`). | New on 2026-05-06: `preflightTableauAnalyze` rejects unknown apiNames before the network call when the SDM cache is preloaded, with the real list of valid apiNames in the rejection's `instruction` field. Catches the most common SDM hallucination at zero round-trip cost. |
| `INVALID_INPUT — don't have access to the semantic model` (post-preflight) | Either (a) the SDM cache is empty so the preflight didn't run, or (b) the cache was refreshed by an admin token but the banker has narrower visibility. | Confirm cache state via `GET /api/admin/refresh-dc-cache` → look at `tableau.cached` and `tableau.apiNames`. If `cached: false`, refresh via `?run=1&tool=tableau&force=1`. Real permission gaps trip the breaker on first occurrence (see `INVALID_INPUT` / "don't have access" in `TRIP_ERROR_PATTERNS`). |
| `analyze_data exceeded 40000ms` (Today path) | Utterance is too long or multi-clause; Tableau's LLM Q&A takes >25s on heavy banker books. | Today's cap progressed 20s → 25s (2026-05-06) → **40s (2026-05-07)**. Today routes stream via SSE from first byte so Heroku's 30s H12 idle timer doesn't apply — the 40s cap is purely a wedged-call backstop. Pulse pins a known-fast utterance (`"Total Current_Balance across Deposits"` on the `Financial_Accounts` SDM) so it stays well under any ceiling. Analyze surface uses a separate 45s cap (`firstPartyTableauNext.ts`). |
| `Unknown tool "tableau_next__list_semantic_models"` | Model called a tool the cache-aware filter strips. | Expected rejection — means a prompt still directs the model to a filtered tool. Rewrite that prompt to point at the injected catalog. |

### Analyze (Kimi + Tableau Next)

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| Kimi says "the data will automatically render as a bar chart below" without calling a tool | Visualization follow-up ("show it as a bar chart") not routed to a fresh `analyze_data` call. | `app/api/analyze-ask/route.ts` detects follow-up intent via regex (pronouns / chart-shape verbs / drill-downs) and sets `forceAnalyzeDataFirstIteration: true` → the agent forces `tool_choice: {type: "function", function: {name: "analyze_data"}}` on iteration 1. Prompt v0.5.0 also lists the "automatic re-render" phrase in the forbidden-phrases block. |
| 5× `analyze_data` calls for one banker question | Kimi sequentially hedges by rephrasing the same question iteration after iteration. | Turn-wide budget in `analyzeAgent.ts`: `turnWideOnceTools = Set(["analyze_data"])`. Once `analyze_data` has run successfully, later iterations' calls return a synthetic "duplicate suppressed" and the model must respond without retrying. |
| Chart x-axis out of chronological order when dates are plotted | MiniMax prose extractor preserves narrative order ("highlights first"). | `lib/analyze/sortByDate.ts` detects a date-like column by name hints + value parseability (≥70% threshold) and stable-sorts rows chronologically before the chart selector runs. |
| Chart shows only 6 points when Analytics Agent's prose mentions "24 months" | Analytics Agent returned a prose highlight reel instead of a complete row set. | Prompt Rule 4 instructs Kimi to phrase `analyze_data` as "List [metric] for each [dimension], one row per [dimension]" and avoid "top", "best", "highest", "notable" unless the banker asked for a ranking. Residual issue on some question shapes — upstream Analytics Agent behavior. |

### Ask My Data (Kimi + Data 360)

| Symptom | Cause | Mitigation |
|---------|--------|------------|
| Query returns empty even though data exists | `post_dc_query_sql` wraps successful results in `{"defaultExc": "<stringified JSON>", ...}` — the MCP wrapper now unwraps this at the boundary. | Both `lib/mcp/client.ts` and `lib/mcp/firstPartyDataCloud.ts` parse the outer envelope, extract `defaultExc`, re-parse the inner JSON, and emit the clean `{data, metadata, responseCode}` shape. Latent bug since Path C landed (fixed 2026-05-06). |
| Kimi writes SQL code blocks into the banker-facing response | Default helpful-LLM drift: when data is sparse, fall back to explaining how to query. | Prompt v0.5.0 Rule 5: "NEVER EMIT SQL IN YOUR RESPONSE." Rule 6: "NEVER EMIT RAW FIELD NAMES." Forbidden phrases include any `__c`, `__dlm`, `ssot__` in final prose. |
| Kimi answers "option 1" incorrectly when banker replies with a single digit | Model sees "1" in isolation without the anchor to its own prior numbered list. | Prompt v0.5.0 Rule 1 (NUMBERED FOLLOW-UPS): re-read your prior assistant message, find the numbered list, pick that option. Never guess. |
| Kimi iteratively tweaks failing SQL 4+ times with unknown-column errors | Without a hard retry cap, Kimi treats each error as "try a different spelling" rather than "give up". | Prompt v0.5.0 Rule 4: "ONE SQL FIX, THEN STOP." Runtime enforces via `ERROR_CIRCUIT_THRESHOLD = 2` (tightened from 3) — breaker trips on strike 2 with an actionable banker fallback narrative. |
| Cross-DMO JOINs fail with "unknown column `i.personname__c`" | Two DMOs with similar concepts but different naming conventions (`ssot__Individual__dlm` uses `ssot__PersonName__c`, `DC_UnifiedssotIndividualIr1__dll` uses `personname__c`); Kimi mixes them up when JOINing. | Prompt v0.5.0 Rule 4a: "AVOID CROSS-DMO JOINS." Explicit guidance to run one query per DMO sequentially and summarize in prose rather than attempt a JOIN across objects with different column conventions. |
| "No life event signals found" when the DMO clearly has data | DMO is outside the top 60 banker-relevant by rowCount (e.g. `ssot__PersonLifeEvent__dlm` at 112 rows sits at position ~347/596). | `dcMetadataCache.ts` has a pinned inclusion list (`pinnedMatchers`) that forces specific DMOs into the top of the catalog regardless of rowCount. Extend the list when adding new semantic-but-low-volume DMOs. |

## Catalog-first prompt discipline

Horizon pre-computes both discovery catalogs (Data Cloud DMOs, Tableau SDMs) and injects them into the system prompt on every turn when cached. See [ARCHITECTURE.md#metadata-cache-layer](./ARCHITECTURE.md#metadata-cache-layer) for the mechanics.

**Hard rule:** no prompt in `lib/prompts/*` may direct the model to call a discovery tool that has been filtered out when the cache is hit. Specifically:

| Server | Filtered-when-cached tools | Prompt must say |
|--------|---------------------------|-----------------|
| `data_360` | `get_dc_metadata`, `getDcMetadata*` | "Pick a DMO VERBATIM from the DATA CLOUD CATALOG block" |
| `tableau_next` | `list_semantic_models`, `getSemanticModels*`, `listModels*` | "Pick an apiName VERBATIM from the TABLEAU NEXT SEMANTIC MODELS block" |

**Why:** when a prompt says "call the metadata tool first" and the runtime has stripped that tool from the OpenAI function list, the model obediently emits the tool_call, the dispatcher rejects it as an unknown tool, and the reasoning trail shows an avoidable `schema mismatch — handled` rejection row. The model has to loop back and self-correct, which wastes iterations and looks messy in the trail. Keeping prompt and filter in sync eliminates the class entirely.

**When adding a new prompt or touching an existing one:**

1. If your prompt needs to reference DC DMO names or columns, say "from the DATA CLOUD CATALOG block" — not "from getDcMetadata".
2. If your prompt needs a Tableau SDM apiName, say "from the TABLEAU NEXT SEMANTIC MODELS block" — not "from list_semantic_models".
3. Add a skip-condition for when the catalog is absent (cold Redis, first deploy): "If the catalog block is absent, skip this facet entirely."

## Hard budget pattern

Every section prompt that does multi-step evidence gathering should open with a `HARD BUDGET` line specifying max tool calls. Observed pattern: without an explicit budget, the model re-queries on every iteration and trails balloon to 12+ calls. Template:

```
HARD BUDGET: Maximum N tool calls total. Do ONE pass of evidence-gathering,
then emit the final output from those results. Do NOT re-query between
output items. Once you have enough evidence, STOP calling tools.
```

Applied across `morning-brief.ts` (5), `draft-queue.ts` (5), `portfolio-pulse.ts` (5).

## Editing checklist

1. Identify the **smallest** prompt file (feature vs `system.ts`).
2. Apply the change; **bump the version constant** in that file.
3. Run `npm run lint && npm run typecheck && npm run build`.
4. If the change affects multi-server behavior, smoke the relevant route (`/api/brief`, `/api/ask`, `/api/prep`, …) with a realistic signed-in session.
5. Update this doc **only** if you added a **new** recurring failure class worth documenting.

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — MCP loop and request flow.
- [OPERATIONS.md](./OPERATIONS.md) — deploy and incident checklist.
- [ARTIFACTS.md](./ARTIFACTS.md) — which UI calls which API.
