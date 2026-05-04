/**
 * Chart-type taxonomy for Analyze.
 *
 * ONE canonical list of supported chart types + rendering specs +
 * validation rules. Used by:
 *   - lib/analyze/chartSelector.ts (MiniMax grounding prompt)
 *   - lib/analyze/validateChartSpec.ts (runtime validator)
 *   - components/analyze/ChartRenderer.tsx (dispatch table)
 *
 * Keeping rules colocated prevents prompt/code drift — a new chart type
 * requires changes in exactly two files (this module + a new component
 * under components/analyze/charts/).
 */

export const CHART_TYPES = [
  "line",
  "area",
  "stacked_area",
  "bar",
  "stacked_bar",
  "grouped_bar",
  "pie",
  "scatter",
  "bubble",
  "kpi",
  "table",
  "histogram",
  "heatmap",
  "funnel",
  "treemap",
  "radar",
  "gauge",
  "waterfall",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/** The chart spec MiniMax emits and the renderer consumes. */
export type ChartSpec = {
  type: ChartType;
  /** Banker-readable title, ≤ 8 words. */
  title?: string;
  /** Columns/keys the chart dimension its axes from. Shape depends on type. */
  props: ChartProps;
  /**
   * One-line narrative pointer for what the chart should emphasize.
   * Not rendered; used by the UI to pick legend placement or annotate.
   */
  narrativeFocus?: string;
};

/**
 * Chart-specific props. Each chart type reads only the fields it needs.
 * We use a single union rather than per-type types so the selector can
 * emit uniform JSON without branching.
 */
export type ChartProps = {
  /** Data rows. Each row is a flat object — row[xKey] → value, row[yKey] → value, etc. */
  data: Array<Record<string, unknown>>;

  // Axis keys
  /** Column name for the X axis (time or categorical label). */
  xKey?: string;
  /** Column name for the Y axis. Used by single-series charts (line, bar). */
  yKey?: string;
  /** Column names for multi-series charts (stacked_bar, grouped_bar, stacked_area). */
  seriesKeys?: string[];

  // Pie / treemap / funnel / radar
  nameKey?: string;
  valueKey?: string;
  categoryKey?: string;

  // Scatter / bubble
  sizeKey?: string; // bubble only — third numeric axis

  // Heatmap
  rowKey?: string;
  colKey?: string;
  intensityKey?: string;

  // KPI / gauge
  value?: number | string;
  previousValue?: number | string;
  unit?: string;
  target?: number;

  // Waterfall
  deltaKey?: string; // numeric delta per step
  labelKey?: string;

  // Radar
  axes?: string[]; // numeric fields forming the spokes

  // Table
  columns?: string[];

  /** Optional axis/legend overrides if MiniMax wants to rename. */
  xLabel?: string;
  yLabel?: string;
};

/**
 * Human-readable description of each chart type's contract.
 * Concatenated into the MiniMax chart-selector prompt so the model
 * picks from a grounded menu with rules.
 */
export const CHART_TYPE_DOC: Record<
  ChartType,
  {
    whenToUse: string;
    dataShape: string;
    requires: string[];
    rejectIf: string[];
  }
> = {
  line: {
    whenToUse:
      "banker asks about trend over time, 'show X over the last N months', 'how has X changed'",
    dataShape:
      "ordered time or ordinal x-axis + 1 numeric y-value per point",
    requires: ["xKey", "yKey", "data (≥ 3 points)"],
    rejectIf: ["fewer than 3 data points", "no time or ordinal xKey"],
  },
  area: {
    whenToUse:
      "cumulative trend, volume-over-time, where area-fill emphasizes running total",
    dataShape: "time or ordinal x-axis + 1 numeric y-value",
    requires: ["xKey", "yKey", "data (≥ 3 points)"],
    rejectIf: ["fewer than 3 data points"],
  },
  stacked_area: {
    whenToUse:
      "composition over time, channel-mix or segment-mix evolution",
    dataShape: "time or ordinal x-axis + 2+ numeric series (same-axis, additive)",
    requires: ["xKey", "seriesKeys (≥ 2)", "data (≥ 3 points)"],
    rejectIf: ["fewer than 2 series", "fewer than 3 data points"],
  },
  bar: {
    whenToUse:
      "simple categorical comparison — 'which X has the most Y'",
    dataShape: "1 categorical + 1 numeric",
    requires: ["xKey", "yKey", "data"],
    rejectIf: ["more than 30 categories (prefer table)"],
  },
  stacked_bar: {
    whenToUse:
      "composition per category, segment-mix within each entity",
    dataShape: "1 categorical + 2+ additive numeric series",
    requires: ["xKey", "seriesKeys (≥ 2)", "data"],
    rejectIf: ["fewer than 2 series"],
  },
  grouped_bar: {
    whenToUse:
      "side-by-side comparison — 'A vs B per rep', 'target vs actual'",
    dataShape: "1 categorical + 2+ independent numeric series",
    requires: ["xKey", "seriesKeys (≥ 2)", "data"],
    rejectIf: ["fewer than 2 series"],
  },
  pie: {
    whenToUse:
      "share of a whole with a clear 100%, small category count",
    dataShape: "1 categorical name + 1 numeric value, 2–8 slices",
    requires: ["nameKey", "valueKey", "data (2–8 slices)"],
    rejectIf: ["fewer than 2 slices", "more than 8 slices"],
  },
  scatter: {
    whenToUse:
      "correlation between two numerics — 'A vs B', 'deal size vs close rate'",
    dataShape: "2 numeric columns",
    requires: ["xKey", "yKey", "data (≥ 5 points)"],
    rejectIf: ["fewer than 5 points"],
  },
  bubble: {
    whenToUse:
      "3-variable correlation — 'A vs B with Z as size' (e.g., revenue × activity × tenure)",
    dataShape: "3 numeric columns",
    requires: ["xKey", "yKey", "sizeKey", "data (≥ 5 points)"],
    rejectIf: ["fewer than 5 points", "no sizeKey"],
  },
  kpi: {
    whenToUse:
      "single headline number with optional comparison — 'YTD revenue', 'current NPS'",
    dataShape: "one number (and optionally a comparison baseline)",
    requires: ["value"],
    rejectIf: ["multi-row tabular data (use bar/line/table)"],
  },
  table: {
    whenToUse:
      "fallback when no chart fits, or banker explicitly asked for 'show me the data'",
    dataShape: "any",
    requires: ["data", "columns"],
    rejectIf: [],
  },
  histogram: {
    whenToUse:
      "distribution of a single numeric — 'how is X distributed', 'balance-size spread'",
    dataShape: "1 numeric column (binned server-side or by the agent)",
    requires: ["xKey", "yKey", "data"],
    rejectIf: ["pre-aggregated categorical data (use bar)"],
  },
  heatmap: {
    whenToUse:
      "density pattern across two categorical dimensions — 'activity by day × rep', 'NPS by region × segment'",
    dataShape: "2 categoricals + 1 numeric intensity",
    requires: ["rowKey", "colKey", "intensityKey", "data"],
    rejectIf: ["grid smaller than 3×3"],
  },
  funnel: {
    whenToUse:
      "ordered stages with progressive drop-off — pipeline, onboarding",
    dataShape: "ordered stages + numeric counts",
    requires: ["labelKey", "valueKey", "data (≥ 3 stages)"],
    rejectIf: [
      "fewer than 3 stages",
      "counts not monotonically decreasing (use bar)",
    ],
  },
  treemap: {
    whenToUse:
      "hierarchical share — 'book by industry × segment', nested proportions",
    dataShape: "hierarchy (categorical) + numeric",
    requires: ["nameKey", "valueKey", "data"],
    rejectIf: ["flat one-level data (use pie)"],
  },
  radar: {
    whenToUse:
      "multi-attribute profile — 'client health across 5 dimensions', rep-scorecard",
    dataShape: "1 entity + 4+ numeric axes (radar spokes)",
    requires: ["axes (≥ 4)", "data"],
    rejectIf: ["fewer than 4 axes"],
  },
  gauge: {
    whenToUse:
      "goal attainment / progress to target — '% to quota', 'NPS goal tracking'",
    dataShape: "1 number + a target",
    requires: ["value", "target"],
    rejectIf: ["no target"],
  },
  waterfall: {
    whenToUse:
      "decomposition of a total — 'starting AUM → inflows → outflows → ending', year-over-year walk",
    dataShape: "ordered deltas with start/end bars",
    requires: ["labelKey", "deltaKey", "data (≥ 3 steps)"],
    rejectIf: ["fewer than 3 steps"],
  },
};

export function isChartType(v: unknown): v is ChartType {
  return typeof v === "string" && (CHART_TYPES as readonly string[]).includes(v);
}
