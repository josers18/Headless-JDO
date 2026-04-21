/**
 * lib/client/extractFollowUps.ts
 *
 * Mirrors extractActions.ts. The Ask Bar prompt (lib/prompts/ask-anything.ts)
 * may append a second fenced JSON block of the shape
 * `{"follow_up_suggestions": ["...", "...", "..."]}` AFTER the optional
 * actions block. These are short, banker-voiced continuation questions the
 * UI renders as quiet pills below the answer.
 *
 * This helper runs AFTER extractActions in the AskBar pipeline, so the
 * actions block (if any) is already gone from `raw`. We look for the last
 * fenced or unfenced JSON object with a `follow_up_suggestions` array.
 *
 * Rules enforced here (defense-in-depth; prompt also constrains):
 *   - max 3 items kept
 *   - trim, drop empties, dedupe case-insensitively
 *   - clamp each to 80 chars (prompt says <= 8 words, but prose from the
 *     model is not always well-behaved; 80 chars is a generous ceiling
 *     that still fits in a pill without wrapping nastily)
 *   - each suggestion must be a non-empty string
 */

export interface ExtractedFollowUps {
  prose: string;
  suggestions: string[];
}

const FENCE_JSON_RE = /```json\s*([\s\S]*?)```/gi;
const FENCE_ANY_RE = /```\s*([\s\S]*?)```/gi;
const UNFENCED_TAIL_RE =
  /(\{[\s\S]*?"follow_up_suggestions"\s*:\s*\[[\s\S]*\})\s*$/;

const MAX_SUGGESTIONS = 3;
const MAX_CHARS = 80;

export function extractFollowUps(raw: string): ExtractedFollowUps {
  if (!raw) return { prose: raw ?? "", suggestions: [] };

  let match: { start: number; end: number; suggestions: string[] } | null =
    null;

  for (const m of raw.matchAll(FENCE_JSON_RE)) {
    if (typeof m.index !== "number") continue;
    const body = (m[1] ?? "").trim();
    const parsed = parseFollowUps(body);
    if (!parsed) continue;
    match = { start: m.index, end: m.index + m[0].length, suggestions: parsed };
  }

  if (!match) {
    for (const m of raw.matchAll(FENCE_ANY_RE)) {
      if (typeof m.index !== "number") continue;
      const body = (m[1] ?? "").trim();
      if (!body.includes('"follow_up_suggestions"')) continue;
      const parsed = parseFollowUps(body);
      if (!parsed) continue;
      match = {
        start: m.index,
        end: m.index + m[0].length,
        suggestions: parsed,
      };
    }
  }

  if (!match) {
    const m = UNFENCED_TAIL_RE.exec(raw);
    if (m && typeof m.index === "number") {
      const parsed = parseFollowUps((m[1] ?? "").trim());
      if (parsed) {
        match = {
          start: m.index,
          end: m.index + m[0].length,
          suggestions: parsed,
        };
      }
    }
  }

  if (!match) return { prose: raw, suggestions: [] };

  const prose = (raw.slice(0, match.start) + raw.slice(match.end))
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { prose, suggestions: match.suggestions };
}

function parseFollowUps(body: string): string[] | null {
  let obj: unknown;
  try {
    obj = JSON.parse(body);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const arr = (obj as { follow_up_suggestions?: unknown })
    .follow_up_suggestions;
  if (!Array.isArray(arr)) return null;

  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of arr) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    const clamped =
      trimmed.length > MAX_CHARS
        ? trimmed.slice(0, MAX_CHARS).trimEnd()
        : trimmed;
    const key = clamped.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(clamped);
    if (cleaned.length >= MAX_SUGGESTIONS) break;
  }
  return cleaned.length > 0 ? cleaned : null;
}
