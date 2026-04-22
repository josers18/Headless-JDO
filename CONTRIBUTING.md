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

Prompts live in `lib/prompts/` — treat edits like code review: bump **version constants** when changing schema or hard rules so caches and reviewers can diff intent.

## Style

TypeScript strict mode is on. Prefer the smallest diff that achieves the outcome; avoid drive-by refactors unrelated to your change.
