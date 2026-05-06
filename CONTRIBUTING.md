# Contributing

Thanks for improving Horizon. Keep changes aligned with the product thesis: **agent-first**, **single surface**, **transparent reasoning**, **premium fintech UI** — not traditional Salesforce chrome.

## Before you open a PR

```bash
npm install
npm run lint
npm run typecheck
npm run build
```

Optional (requires a configured `.env` with valid Salesforce / inference vars):

```bash
npm run verify:mcp
```

## Secrets

Never commit `.env`, API keys, OAuth secrets, or inference keys. Use placeholders in documentation and examples.

## Prompts & behavior

Prompts live in `lib/prompts/` — treat edits like code review.

1. Read [**docs/LLM_PROMPT_GUIDE.md**](docs/LLM_PROMPT_GUIDE.md) first. It catalogs known failure modes per agent (Today / Analyze / Ask My Data) with their mitigations.
2. Pick the right file for the scope of your change:
   - **All agents**: extend `lib/prompts/system.ts` (SOQL hygiene, DC metadata gate, Tableau binding, owner-pivot guardrails). Currently **v1.6.0**.
   - **Today only**: feature-specific files under `lib/prompts/` (`morning-brief.ts`, `prep.ts`, `arc.ts`, `priority-queue.ts`, etc.).
   - **Analyze surface**: `lib/prompts/analyze.ts` (Kimi + Tableau Next). Currently v0.5.0.
   - **Ask My Data surface**: `lib/prompts/ask-data.ts` (Kimi + Data 360). Currently v0.5.0.
   - **Follow-up pills**: `lib/prompts/ask-data-followups.ts` (MiniMax, JSON-object output). Currently v0.3.0.
3. Bump the **version export** in every file you change (`SYSTEM_PROMPT_VERSION`, `ANALYZE_PROMPT_VERSION`, `ASK_DATA_PROMPT_VERSION`, etc.). Version history is the first thing we check when a reasoning-trail regression surfaces in prod.
4. Run `npm run build` before opening a PR.
5. When a change affects multiple agents, test all affected surfaces — the three agent loops (`lib/llm/heroku.ts`, `lib/inference/analyzeAgent.ts`, `lib/inference/askDataAgent.ts`) share patterns but not code.

## Style

TypeScript strict mode is on. Prefer the smallest diff that achieves the outcome; avoid drive-by refactors unrelated to your change.
