/**
 * MiniMax chart selector. Given a banker question + structured data
 * returned by `analyze_data`, picks one of the 18 chart types plus
 * the column/key mappings.
 *
 * Grounded in `CHART_TYPE_DOC` — the prompt enumerates every type with
 * `whenToUse` / `dataShape` / `rejectIf`. Output always passes through
 * `validateChartSpec` before the UI sees it; invalid picks fall back
 * to `table`.
 */

import { inferHeroku } from "@/lib/inference/heroku";
import {
  CHART_TYPE_DOC,
  CHART_TYPES,
  type ChartSpec,
} from "./chartTypes";
import { validateChartSpec } from "./validateChartSpec";

export const CHART_SELECTOR_PROMPT_VERSION = "v0.1.0";

function buildSelectorPrompt(): string {
  const typeRules = CHART_TYPES.map((t) => {
    const doc = CHART_TYPE_DOC[t];
    return [
      `### ${t}`,
      `- whenToUse: ${doc.whenToUse}`,
      `- dataShape: ${doc.dataShape}`,
      `- requires: ${doc.requires.join(", ")}`,
      doc.rejectIf.length > 0
        ? `- rejectIf: ${doc.rejectIf.join("; ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }).join("\n\n");

  return `
You are the chart selector for Analyze, Horizon's governed analytics
workbench for a banker. You receive:
  (1) the banker's question, and
  (2) the structured data Tableau Next just returned (a JSON preview
      of the first rows).

Pick ONE chart type from the list below. Output a strict JSON object
matching the ChartSpec schema. No prose, no code fences.

ALLOWED TYPES (pick exactly one, spelled exactly as shown):
  ${CHART_TYPES.join(", ")}

SELECTION RULES — for each type:

${typeRules}

OUTPUT SCHEMA

\`\`\`
{
  "type": "<one of the types above>",
  "title": "<≤ 8 words, banker-readable>",
  "narrativeFocus": "<one-sentence pointer to what to emphasize>",
  "props": {
    "data": [ ... rows, unchanged from input ... ],
    "xKey": "<column name>",       // time/categorical axis
    "yKey": "<column name>",       // single numeric
    "seriesKeys": ["colA", "colB"], // multi-series charts
    "nameKey": "<column>",         // pie/treemap/funnel/radar
    "valueKey": "<column>",         // pie/treemap/funnel
    "categoryKey": "<column>",
    "sizeKey": "<column>",          // bubble only (third numeric)
    "rowKey": "<column>",           // heatmap
    "colKey": "<column>",           // heatmap
    "intensityKey": "<column>",     // heatmap
    "value": <number or string>,     // kpi/gauge
    "previousValue": <number or string>, // kpi
    "unit": "<string>",
    "target": <number>,              // gauge
    "deltaKey": "<column>",          // waterfall
    "labelKey": "<column>",          // waterfall/funnel
    "axes": ["col1", "col2", "col3", "col4"], // radar
    "columns": ["col1", "col2"],      // table fallback
    "xLabel": "<axis label>",
    "yLabel": "<axis label>"
  }
}
\`\`\`

Only include the prop fields the chosen type requires. Put the incoming
data rows into \`props.data\` verbatim — do not resample, pivot, or
re-aggregate.

DISCIPLINE
- Never invent a chart type not in the list above.
- If the data violates any \`rejectIf\` rule for your chosen type, pick
  a different type (or fall back to "table" if no type fits).
- Prefer concrete, common types (line, bar, kpi, table) over niche ones
  (treemap, radar, funnel, waterfall) unless the banker's question
  clearly signals the niche case.
- If the data is single-row and contains one aggregate number, prefer
  "kpi".
- If the data is multi-row and ordered by time, prefer "line" or
  "area".
- If you cannot decide, pick "table".
`.trim();
}

const SELECTOR_PROMPT = buildSelectorPrompt();

/**
 * Ask MiniMax to pick a chart + validate. Always returns a ChartSpec
 * (the validator guarantees a `table` fallback on any failure).
 */
export async function selectChartSpec(input: {
  bankerQuestion: string;
  data: Array<Record<string, unknown>>;
  /** Optional caption from the agent (e.g. `analyze_data`'s "answer" field). */
  caption?: string;
}): Promise<{ spec: ChartSpec; wasFallback: boolean; fallbackReason?: string }> {
  const preview = input.data.slice(0, 40);
  const userMsg = [
    `BANKER QUESTION:\n${input.bankerQuestion.slice(0, 800)}`,
    input.caption ? `\nTABLEAU CAPTION:\n${input.caption.slice(0, 500)}` : "",
    `\nDATA PREVIEW (${preview.length} of ${input.data.length} rows):\n${JSON.stringify(preview)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let raw: unknown;
  try {
    const res = await inferHeroku({
      tier: "short",
      system: SELECTOR_PROMPT,
      messages: [{ role: "user", content: userMsg }],
      // why: tier "short" is MiniMax M2, a thinking model that burns
      // completion-token budget on silent internal reasoning before any
      // visible JSON (see proseToData.ts). This call also echoes a 40-row
      // data preview back in props.data, so the visible output alone can be
      // large. The old 1600 ceiling truncated mid-reasoning → empty text →
      // table fallback / no chart. 8000 covers reasoning + a full spec;
      // it's a ceiling, not a target. See charts bug, 2026-06-19.
      maxTokens: 8000,
      temperature: 0.2,
      responseFormat: { type: "json_object" },
    });
    if (res.stopReason === "length") {
      // Truncated before a complete spec — fall through to validateChartSpec,
      // which yields the table fallback, but log so we know the budget bit.
      const result = validateChartSpec(null, input.data);
      return {
        spec: result.ok ? result.spec : result.fallback,
        wasFallback: true,
        fallbackReason: "selector truncated (finish_reason=length)",
      };
    }
    raw = parseJsonLoose(res.text);
  } catch (e) {
    // MiniMax failed — return a table.
    const result = validateChartSpec(null, input.data);
    return {
      spec: result.ok ? result.spec : result.fallback,
      wasFallback: true,
      fallbackReason: `selector error: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Ensure the data on the spec is the real dataset, not a subset the
  // model may have echoed back. Data lives server-side; the selector
  // only dictates type + key mappings.
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const props = (obj.props ?? {}) as Record<string, unknown>;
    props.data = input.data;
    obj.props = props;
  }

  const validated = validateChartSpec(raw, input.data);
  if (validated.ok) {
    return { spec: validated.spec, wasFallback: false };
  }
  return {
    spec: validated.fallback,
    wasFallback: true,
    fallbackReason: validated.reason,
  };
}

function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Try stripping code fences / extracting the first JSON object.
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
