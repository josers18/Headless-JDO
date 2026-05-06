# Documentation index

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System diagram (Mermaid), MCP loop, key paths, **metadata cache layer** |
| [OPERATIONS.md](./OPERATIONS.md) | Deploy (Heroku), quality gates, secrets, **scheduled jobs**, incidents, triage |
| [ARTIFACTS.md](./ARTIFACTS.md) | UI ↔ API map, npm scripts, admin endpoints |
| [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) | **Prompt sources, version bumps, catalog-first discipline, failure catalog** |
| [CURSOR_MCP_SETUP.md](./CURSOR_MCP_SETUP.md) | Cursor IDE MCP optional setup |
| [SEED_DATA_SPEC.md](./SEED_DATA_SPEC.md) | Synthetic / org data notes (CRM / FSC focus) |

**Contributors:** read [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) before editing `lib/prompts/*`.

**Recent milestones:**

- **2026-05-06 — Agent loop hardening + `defaultExc` unwrap.** Every successful `post_dc_query_sql` was being wrapped in a string-inside-string envelope that the agent couldn't read; the unwrap lives at both MCP wrapper boundaries now. Also: turn-wide `analyze_data` budget on Analyze, synthetic-guard circuit-breaker shield, `<think>`-tag streaming stripper in Ask My Data, visualization-follow-up tool-choice forcing, unified dark/light chart palette, Ask My Data Markdown rendering + preloaded DC catalog + pinned-DMO inclusion list, dev-friendly admin refresh route. See [LLM_PROMPT_GUIDE.md](./LLM_PROMPT_GUIDE.md) failure-mode catalog for the full list.
- **2026-05-01 — Metadata cache layer.** The agent preloads Data Cloud DMO metadata and Tableau semantic models from a Redis cache refreshed by Heroku Scheduler. Discovery tools (`get_dc_metadata`, `list_semantic_models`) are hidden from the model when the cache is warm — the catalog in the system prompt replaces them. See [ARCHITECTURE.md#metadata-cache-layer](./ARCHITECTURE.md#metadata-cache-layer) and [OPERATIONS.md#scheduled-jobs](./OPERATIONS.md#scheduled-jobs).
- **2026-04-30 — Path C.** `data_360` + `tableau_next` moved off the custom self-hosted MCP onto the first-party `/platform/mcp/v1/{data|analytics}/…` endpoints. Next 14 → 15 upgrade + async-boundary migration. Anthropic-direct LLM fallback retired; everything runs on Heroku Inference now.

Start with **ARCHITECTURE.md**, then **OPERATIONS.md** for shipping changes.
