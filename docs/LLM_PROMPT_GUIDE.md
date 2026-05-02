# Horizon — LLM prompts & agent hygiene

This document is for **humans and coding agents** who change how Horizon talks to Claude (Heroku Inference) and the Salesforce MCPs. The **authoritative runtime text** still lives in TypeScript so it ships with the app and is type-checked; this file explains **where**, **how to edit safely**, and **recorded failure modes** from production reasoning trails.

## Source of truth (runtime)

| File | Role |
|------|------|
| [`lib/prompts/system.ts`](../lib/prompts/system.ts) | Shared **MCP HYGIENE** block: Data Cloud metadata gate, SOQL rules, Tableau semantic binding, universal tone rules. Export: `SYSTEM_PROMPT`, `SYSTEM_PROMPT_VERSION`. |
| [`lib/prompts/ask-anything.ts`](../lib/prompts/ask-anything.ts) | Ask bar: schema discipline, org field allow-lists, output JSON contracts. |
| [`lib/prompts/morning-brief.ts`](../lib/prompts/morning-brief.ts) | Morning brief structure, CRM + Data 360 + Tableau expectations. |
| Other `lib/prompts/*.ts` | Feature-specific instructions (`prep`, `arc`, `priority-queue`, `signals`, etc.). |

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
| `no access to the semantic model` | Passing category label (`"Sales"`) as model id. | Pick an `apiName` **verbatim** from the TABLEAU NEXT SEMANTIC MODELS catalog injected into the system prompt. Never improvise a model id. |
| `analyze_data exceeded 20000ms` | Utterance is too long or multi-clause; Tableau's LLM Q&A takes >20s. | Keep utterances under 15 words and single-facet (one metric, one filter window). Break compound questions into separate analyze calls — the Tableau side times out faster on simple questions. |
| `Unknown tool "tableau_next__list_semantic_models"` | Model called a tool the cache-aware filter strips. | Expected rejection — means a prompt still directs the model to a filtered tool. Rewrite that prompt to point at the injected catalog. |

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
