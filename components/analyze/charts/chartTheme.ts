"use client";

/**
 * Shared helpers that inject theme-aware CSS variables into Recharts
 * primitives. Recharts accepts `stroke`, `fill`, `stopColor`, etc. as
 * strings — we pass `var(--hz-chart-N)` directly so every chart reskins
 * when the banker swaps themes (42 themes, zero per-chart edits).
 */

export const CHART_VARS = [
  "var(--hz-chart-1)",
  "var(--hz-chart-2)",
  "var(--hz-chart-3)",
  "var(--hz-chart-4)",
  "var(--hz-chart-5)",
  "var(--hz-chart-6)",
  "var(--hz-chart-7)",
  "var(--hz-chart-8)",
] as const;

/** Color for the Nth series (cycles past 8). */
export function seriesColor(index: number): string {
  return CHART_VARS[index % CHART_VARS.length]!;
}

export const CHART_GRID = "var(--hz-chart-grid)";
export const CHART_AXIS = "var(--hz-chart-axis)";
export const CHART_HEAT_LOW = "var(--hz-chart-heat-low)";
export const CHART_HEAT_HIGH = "var(--hz-chart-heat-high)";

/** Tooltip style merged into each Recharts Tooltip component. */
export const TOOLTIP_STYLES = {
  contentStyle: {
    background: "var(--hz-surface-raised)",
    border: "1px solid var(--hz-border-soft)",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 12,
    color: "var(--hz-text)",
  } as const,
  labelStyle: { color: "var(--hz-text-muted)", marginBottom: 4 } as const,
  itemStyle: { color: "var(--hz-text)" } as const,
  cursor: { stroke: "var(--hz-chart-grid)", strokeWidth: 1 } as const,
};

/** Axis props shared by line / area / bar / scatter. */
export const AXIS_PROPS = {
  stroke: CHART_AXIS,
  tick: { fill: CHART_AXIS, fontSize: 11 } as const,
  tickLine: false,
  axisLine: { stroke: CHART_GRID } as const,
};

/** Legend props matched to Horizon's typographic restraint. */
export const LEGEND_PROPS = {
  wrapperStyle: {
    paddingTop: 12,
    fontSize: 11,
    color: "var(--hz-text-muted)",
  } as const,
};
