/**
 * Parse structured data out of Analytics Agent prose responses.
 *
 * Tableau Next's `analyze_data` often returns a natural-language
 * narrative with numbers embedded in markdown rather than structured
 * rows. Example: "February 2026 with an average CSAT score of **73.55**".
 *
 * We use MiniMax (tier="short") to structure the prose into a
 * `{columns, rows}` shape that the chart selector + renderers
 * already know how to handle. Purely best-effort — if the prose has
 * no extractable data, we return null and the UI renders narrative
 * only.
 */

import { inferHeroku } from "@/lib/inference/heroku";
import { log } from "@/lib/log";

export type ProseExtractedTable = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

const SYSTEM_PROMPT = `
You extract structured tabular data from a short analytical narrative.
Your input is a paragraph-style answer that mentions numbers organized
along some dimension (dates, categories, segments, ranks).

Task: return a JSON object with two arrays:
  { "columns": ["col1","col2", ...], "rows": [ {col1:val,col2:val}, ... ] }

RULES
- Only emit rows that are explicitly stated in the text. Do NOT infer,
  interpolate, or fill in missing values.
- Use the most natural column naming (e.g. "month", "score",
  "category", "count"). Prefer short names (≤ 24 chars).
- Column types may mix string and number; numbers MUST be plain
  JavaScript numbers (no units, no percent signs, no formatting).
- If the narrative describes at most a single aggregate number with
  no breakdown, return { "columns": ["value"], "rows": [{"value": N}] }.
- If you cannot extract any tabular data with confidence, return
  { "columns": [], "rows": [] }.
- Cap at 50 rows. Deduplicate identical rows.
- Output strict JSON. No prose, no markdown fences.
`.trim();

const MIN_ROWS_FOR_CHART = 1;

export async function extractStructuredFromProse(input: {
  question: string;
  prose: string;
}): Promise<ProseExtractedTable | null> {
  const prose = (input.prose ?? "").trim();
  if (!prose || prose.length < 30) return null;
  // Guard against accidentally handing a giant doc to MiniMax — the
  // narratives we see from analyze_data are typically 500–3000 chars.
  const capped = prose.slice(0, 8_000);

  try {
    const res = await inferHeroku({
      tier: "short",
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `QUESTION: ${input.question.slice(0, 500)}\n\nNARRATIVE:\n${capped}`,
        },
      ],
      temperature: 0.1,
      maxTokens: 2500,
      responseFormat: { type: "json_object" },
    });
    const parsed = parseLoose(res.text);
    if (!parsed || typeof parsed !== "object") {
      log.warn("prose_extract.parse_empty", {
        rawLen: res.text?.length ?? 0,
        rawPreview: (res.text ?? "").slice(0, 240),
      });
      return null;
    }
    const obj = parsed as Record<string, unknown>;
    const columns = Array.isArray(obj.columns)
      ? (obj.columns as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : [];
    const rows = Array.isArray(obj.rows)
      ? (obj.rows as unknown[]).filter(
          (r): r is Record<string, unknown> =>
            r !== null && typeof r === "object"
        )
      : [];
    if (columns.length === 0 || rows.length < MIN_ROWS_FOR_CHART) {
      log.warn("prose_extract.no_rows", {
        proseLen: prose.length,
        proseHead: prose.slice(0, 120),
        columns: columns.length,
        rows: rows.length,
      });
      return null;
    }
    log.info("prose_extract.ok", {
      columns: columns.length,
      rows: rows.length,
    });
    return { columns, rows };
  } catch (err) {
    log.error("prose_extract.threw", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function parseLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
