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

1. Read [**docs/LLM_PROMPT_GUIDE.md**](docs/LLM_PROMPT_GUIDE.md) first.
2. Prefer extending **`lib/prompts/system.ts`** for rules that must apply to *every* agent route (SOQL hygiene, Data Cloud metadata gate, Tableau binding).
3. Bump the **version export** in every file you change (`SYSTEM_PROMPT_VERSION`, `MORNING_BRIEF_PROMPT_VERSION`, `PREP_PROMPT_VERSION`, etc.).
4. Run `npm run build` before opening a PR.

## Style

TypeScript strict mode is on. Prefer the smallest diff that achieves the outcome; avoid drive-by refactors unrelated to your change.
