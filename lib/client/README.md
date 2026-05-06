# `lib/client/` — Client hooks + browser-only helpers

[![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![Hooks](https://img.shields.io/badge/hooks-custom-3178c6)](https://react.dev/learn/reusing-logic-with-custom-hooks)
[![SSE](https://img.shields.io/badge/transport-SSE-f59e0b)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)

Everything that runs in the browser only. Custom hooks (SSE streams, theming, voice), pure browser-side utilities (sanitizers, JSON streamers, event buses), and the theme provider. Code in this folder cannot run on the server — it imports browser APIs (`window`, `navigator`, `SpeechRecognition`, `EventSource`-shape streaming) and is loaded only via Client Components.

> **Why not call this `hooks/`?** Some files here are stateless pure helpers (sanitizers, formatters) that *don't* return hook values but still must run only in the browser (because they use `DOMParser` or `window.crypto`, or because they're consumed exclusively by Client Components). Keeping them next to the hooks avoids a parallel folder for "browser-only utils."

## Hooks

### Streaming

| Hook | Used by | Wraps |
|------|---------|-------|
| `useAgentStream.ts` | Today surfaces (Brief, Arc, Queue, Pulse, Drafts, Insights, AskBar, Prep) | Generic SSE consumer for `/api/{brief,priority,pulse,drafts,signals,ask,prep,client,arc,insights}`. Exposes `{narrative, steps, state, error, inferenceMeta, start, reset, cancel}`. |
| `useAnalyzeStream.ts` | `AnalyzeWorkbench` | SSE consumer for `/api/analyze-ask` — adds `chart_spec`, `table_fallback`, `tool_call`, `tool_result`, `persisted` event types beyond the Today protocol. |
| `useAskDataStream.ts` | Ask My Data `Conversation` | Isolated 9-event SSE protocol for `/api/ask-data` — `token`, `tool_call`, `tool_result`, `follow_ups`, `thread_title`, `assistant_persisted`, `done`, `error`, `meta`. |

All three implement the same skeleton: `fetch` with `Accept: text/event-stream`, a parser that buffers SSE frames, and React state that surfaces incrementally — never block-and-await. AbortController support for unmount-safe cancellation.

### Voice

| Hook | Role |
|------|------|
| `useSpokenNarration.ts` | Web Speech API TTS wrapper — `{supported, speaking, play, stop}`. Falls back to ElevenLabs via `/api/tts` when configured. |
| `useSpeechInput.ts` | Web SpeechRecognition wrapper — interim + final transcript into the AskBar. Gracefully hides the mic button when unsupported. |

### Theme

| File | Role |
|------|------|
| `ThemeProvider.tsx` | Context provider mounted in `app/layout.tsx`. Reads `localStorage`, sets `data-theme="…"` on `<html>`, exposes `{theme, setTheme}` via context. |
| `useTheme.ts` | Consumer hook used by `ThemeSwitcher` and any component that needs theme-aware behavior. |

## Client-side utilities

### Streaming-aware parsing

| File | Purpose |
|------|---------|
| `jsonStream.ts` | `tryParseJson<T>(narrative)` — best-effort streaming-JSON parse for sections that return structured output (Morning Brief, Pulse, Arc, Priority Queue). Returns null until the buffer is well-formed. |
| `sanitizeNarrative.ts` | Strip `<think>…</think>` tags that occasionally leak from Kimi's chain-of-thought. Streaming-safe across chunk boundaries. |
| `pulseCopySanitize.ts` | Clean banker-facing pulse copy of internal jargon and tool names. |
| `pulseMetricHygiene.ts` | Apply normalization rules to Pulse KPIs (delta direction, value formatting). |
| `stripSalesforceIds.ts` | Remove inline 18-char SF IDs from prose where the linked label is already shown. |

### Action / extraction

| File | Purpose |
|------|---------|
| `extractActions.ts` | Pull pre-drafted actions from streamed JSON; merge new with existing on each frame. |
| `extractFollowUps.ts` | Pull follow-up pill suggestions from the streamed payload. |
| `extractNamesForProbing.ts` | Find Account / Contact name candidates in narrative for inline-link probing. |
| `actions/` | Sub-helpers that map an action draft to its execution endpoint. |

### Specialized models

| File | Purpose |
|------|---------|
| `pulseTileModel.ts` | Resolve a `PulseTile`'s explanation popover state (loading / loaded / collapsed). |
| `prepDraft.ts` | Build a "Prep me" question payload for the AskBar from a client row. |
| `rightNowCta.ts` | Map the Morning Brief hero to its primary action button (View context / Reply / Schedule). |
| `rightNowSnooze.ts` | Per-section snooze state (1-hour suppression of an item). |

### Cross-component event bus

| File | Purpose |
|------|---------|
| `horizonEvents.ts` | Window-level custom-event names — `HORIZON_REFRESH_BRIEF`, `HORIZON_REFRESH_PULSE`, `HORIZON_FOCUS_CLIENT`, etc. Components listen + dispatch instead of prop-drilling. |
| `agentStartStagger.ts` | Per-section delays so Today doesn't fire 5 SSE streams in the same tick (avoids stacking 401 cascades pre-auth). |
| `sfLabelsCache.ts` | In-memory cache of SF-ID → label resolutions across the page. Backed by `/api/sf/labels`. |

## Conventions

- Every file is **client-only**. Importing them from a Server Component will fail at build time.
- Hooks return `{state, actions}` objects, not tuples — easier to ignore unused fields.
- SSE consumers always expose a `cancel()` for unmount-safe teardown.
- StrictMode-safe: any effect that fetches data uses an `AbortController` + cancellation flag pattern (see `AnalyzeFollowUps.tsx` for the canonical example).

## Related

- [`components/README.md`](../../components/README.md) — which UI consumes which hook.
- [`lib/sse/stream.ts`](../sse/stream.ts) — server-side SSE helpers (the other half of the protocol).
- [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md) — request flow including the SSE layer.
