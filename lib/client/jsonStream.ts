/**
 * lib/client/jsonStream.ts — parse a partial, possibly-fenced JSON object
 * out of a streaming LLM narrative.
 *
 * Our agent routes are pure SSE text_delta streams. Several of them
 * (Morning Brief, Priority Queue, Portfolio Pulse) prompt the model to
 * return JSON only, but the model will often wrap it in ```json fences or
 * prepend a short sentence. We also want components to render as soon as
 * the object _closes_ — usually well before `state === "done"`.
 *
 * `extractJsonObject` is the common brace-balancer used by those
 * components; it is resilient to fences, leading prose, and stream-in-
 * progress text.
 */

export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const stripped = stripFence(text);
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

export function tryParseJson<T>(text: string): T | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  try {
    return JSON.parse(obj) as T;
  } catch {
    return null;
  }
}

function stripFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fence?.[1] ?? text).trim();
}
