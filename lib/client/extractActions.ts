/**
 * lib/client/extractActions.ts
 *
 * The Ask Bar prompt (see lib/prompts/ask-anything.ts) instructs the model
 * to return a short markdown narrative followed OPTIONALLY by a single
 * fenced JSON block of the shape `{"actions":[...]}`. This helper pulls
 * that block out of a (possibly still streaming) narrative so the UI can
 * render prose above and clickable action chips below.
 *
 * Behavior:
 *  - Looks for the LAST ```json fence in the text whose JSON body parses
 *    to an object with an `actions` array. That block is removed from the
 *    prose.
 *  - Ignores fences whose body is not valid JSON — those might be the
 *    model mid-stream (we haven't closed the fence yet).
 *  - Ignores JSON objects that don't contain `actions` — callers of other
 *    endpoints (brief, priority, drafts) stream object JSON too, but for
 *    /api/ask the shape is specifically `{"actions":[...]}`.
 *  - Returns the full raw string as prose when no valid actions block is
 *    found (no destructive edits).
 */

import type { DraftAction } from "@/types/horizon";

export interface ExtractedAskResponse {
  prose: string;
  actions: DraftAction[];
}

const FENCE_RE = /```json\s*([\s\S]*?)```/gi;
// Also match unfenced ```…``` blocks (no language tag) that *contain*
// the "actions" key. The model occasionally omits the json tag.
const FENCE_ANY_RE = /```\s*([\s\S]*?)```/gi;

// Unfenced tail JSON: the model dumps a raw `{"actions":[...]}` at the
// end of its response without any code fence around it. Our Q1 demo
// showed exactly this pattern (JSON truncated mid-stream with no fence).
// We match the LAST top-level object in the string that starts with {
// and contains an "actions" key near the top.
const UNFENCED_ACTIONS_RE = /(\{[\s\S]*?"actions"\s*:\s*\[[\s\S]*\})\s*$/;

export function extractActions(raw: string): ExtractedAskResponse {
  if (!raw) return { prose: raw ?? "", actions: [] };

  let lastMatch: { start: number; end: number; actions: DraftAction[] } | null =
    null;

  // 1) Preferred path: fenced ```json block that parses to {actions:[]}.
  for (const m of raw.matchAll(FENCE_RE)) {
    if (typeof m.index !== "number") continue;
    const body = (m[1] ?? "").trim();
    const parsed = safeParse(body);
    if (!parsed || typeof parsed !== "object") continue;
    const rawActions = (parsed as { actions?: unknown }).actions;
    if (!Array.isArray(rawActions)) continue;
    const actions = rawActions.filter(isDraftAction);
    if (actions.length === 0) continue;
    lastMatch = {
      start: m.index,
      end: m.index + m[0].length,
      actions,
    };
  }

  // 2) Fallback: any fenced block (no lang tag) that parses.
  if (!lastMatch) {
    for (const m of raw.matchAll(FENCE_ANY_RE)) {
      if (typeof m.index !== "number") continue;
      const body = (m[1] ?? "").trim();
      if (!body.includes('"actions"')) continue;
      const parsed = safeParse(body);
      if (!parsed || typeof parsed !== "object") continue;
      const rawActions = (parsed as { actions?: unknown }).actions;
      if (!Array.isArray(rawActions)) continue;
      const actions = rawActions.filter(isDraftAction);
      if (actions.length === 0) continue;
      lastMatch = {
        start: m.index,
        end: m.index + m[0].length,
        actions,
      };
    }
  }

  // 3) Last-resort fallback: UNFENCED `{"actions":[...]}` at the tail.
  // The model sometimes skips the code fence entirely. We only do this
  // when fenced extraction failed to avoid nuking legitimate inline
  // JSON inside prose.
  if (!lastMatch) {
    const m = UNFENCED_ACTIONS_RE.exec(raw);
    if (m && typeof m.index === "number") {
      const body = (m[1] ?? "").trim();
      const parsed = safeParse(body);
      if (parsed && typeof parsed === "object") {
        const rawActions = (parsed as { actions?: unknown }).actions;
        if (Array.isArray(rawActions)) {
          const actions = rawActions.filter(isDraftAction);
          if (actions.length > 0) {
            lastMatch = {
              start: m.index,
              end: m.index + m[0].length,
              actions,
            };
          }
        }
      }
    }
  }

  if (!lastMatch) return { prose: raw, actions: [] };

  const prose = (raw.slice(0, lastMatch.start) + raw.slice(lastMatch.end))
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { prose, actions: lastMatch.actions };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isDraftAction(v: unknown): v is DraftAction {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.title === "string" &&
    typeof o.body === "string" &&
    typeof o.target_id === "string" &&
    typeof o.target_object === "string" &&
    (o.kind === "task" ||
      o.kind === "email" ||
      o.kind === "call" ||
      o.kind === "update")
  );
}
