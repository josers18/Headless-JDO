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

/** Balance-aware slice from `{` at `start` through its closing `}`. */
function balancedObjectSlice(stripped: string, start: number): string | null {
  if (stripped[start] !== "{") return null;
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

export function extractJsonObject(text: string): string | null {
  if (!text) return null;
  const stripped = stripFence(text);
  const start = stripped.indexOf("{");
  if (start === -1) return null;
  return balancedObjectSlice(stripped, start);
}

/** Drop trailing commas before `}` / `]` — models often emit invalid JSON. */
function parseJsonLenient(fragment: string): unknown | null {
  try {
    return JSON.parse(fragment);
  } catch {
    try {
      const stripped = fragment.replace(/,\s*([\]}])/g, "$1");
      return JSON.parse(stripped);
    } catch {
      return null;
    }
  }
}

/** Collect `{…}` slices at every brace position (handles leading prose / junk). */
function enumerateJsonObjectSlicesFromStem(stem: string): string[] {
  const stripped = stem.trim();
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i] !== "{") continue;
    const slice = balancedObjectSlice(stripped, i);
    if (slice && !seen.has(slice)) {
      seen.add(slice);
      out.push(slice);
    }
  }
  out.sort((a, b) => b.length - a.length);
  return out;
}

/** Every ```json … ``` body plus the full text (models often mix fences + prose). */
function stemsForJsonScan(text: string): string[] {
  const stems: string[] = [];
  const re = /```(?:json)?\s*([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const body = m[1]?.trim();
    if (body) stems.push(body);
  }
  stems.push(text.replace(/\uFEFF/g, "").trim());
  return stems;
}

/** Curly/smart quotes break JSON.parse — normalize before retry. */
function normalizeSmartQuotes(s: string): string {
  return s
    .replace(/\u201C|\u201D|\u201E|\u00AB|\u00BB/g, '"')
    .replace(/\u2018|\u2019|\u201A|\u2032/g, "'");
}

export function tryParseJson<T>(text: string): T | null {
  if (!text) return null;

  const stemSeen = new Set<string>();
  const candidates: string[] = [];
  const sliceSeen = new Set<string>();

  for (const stem of stemsForJsonScan(text)) {
    if (!stem || stemSeen.has(stem)) continue;
    stemSeen.add(stem);
    for (const slice of enumerateJsonObjectSlicesFromStem(stem)) {
      if (!sliceSeen.has(slice)) {
        sliceSeen.add(slice);
        candidates.push(slice);
      }
    }
  }

  candidates.sort((a, b) => b.length - a.length);

  for (const frag of candidates) {
    let val = parseJsonLenient(frag);
    if (val === null) val = parseJsonLenient(normalizeSmartQuotes(frag));
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      return val as T;
    }
  }

  return null;
}

function stripFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fence?.[1] ?? text).trim();
}
