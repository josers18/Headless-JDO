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

**New in this repo (2026-05-01):** the agent preloads Data Cloud DMO metadata and Tableau semantic models from a Redis cache refreshed by Heroku Scheduler. Discovery tools (`get_dc_metadata`, `list_semantic_models`) are hidden from the model when the cache is warm — the catalog in the system prompt replaces them. See [ARCHITECTURE.md#metadata-cache-layer](./ARCHITECTURE.md#metadata-cache-layer) and [OPERATIONS.md#scheduled-jobs](./OPERATIONS.md#scheduled-jobs).

Start with **ARCHITECTURE.md**, then **OPERATIONS.md** for shipping changes.
