/**
 * Runtime validator for the ChartSpec returned by MiniMax.
 *
 * Rules here mirror `rejectIf` / `requires` in CHART_TYPE_DOC. If MiniMax
 * picks a type but the data doesn't meet the contract, we fall back to
 * `table` with a note server-side (Q-T2-4-a grounding rules). This is
 * what prevents a demo-ruining chart crash.
 */

import type { ChartProps, ChartSpec, ChartType } from "./chartTypes";
import { isChartType } from "./chartTypes";

export type ValidationResult =
  | { ok: true; spec: ChartSpec }
  | { ok: false; reason: string; fallback: ChartSpec };

/**
 * Validate a MiniMax-emitted chart spec. On failure, returns a fallback
 * `table` spec so the UI always has something to render.
 */
export function validateChartSpec(
  raw: unknown,
  fallbackData: Array<Record<string, unknown>>
): ValidationResult {
  const tableFallback = buildTableFallback(fallbackData);

  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      reason: "spec is not an object",
      fallback: tableFallback,
    };
  }

  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  if (!isChartType(type)) {
    return {
      ok: false,
      reason: `type "${String(type)}" is not a recognized chart type`,
      fallback: tableFallback,
    };
  }

  const props = (obj.props ?? {}) as Record<string, unknown>;
  const data = Array.isArray(props.data)
    ? (props.data as Array<Record<string, unknown>>)
    : fallbackData;

  // All validators read from a normalized props object so they don't
  // care about missing fields defaulting to undefined.
  const p: ChartProps = {
    data,
    xKey: asString(props.xKey),
    yKey: asString(props.yKey),
    seriesKeys: asStringArray(props.seriesKeys),
    nameKey: asString(props.nameKey),
    valueKey: asString(props.valueKey),
    categoryKey: asString(props.categoryKey),
    sizeKey: asString(props.sizeKey),
    rowKey: asString(props.rowKey),
    colKey: asString(props.colKey),
    intensityKey: asString(props.intensityKey),
    value: asPrimitive(props.value),
    previousValue: asPrimitive(props.previousValue),
    unit: asString(props.unit),
    target: asNumber(props.target),
    deltaKey: asString(props.deltaKey),
    labelKey: asString(props.labelKey),
    axes: asStringArray(props.axes),
    columns: asStringArray(props.columns),
    xLabel: asString(props.xLabel),
    yLabel: asString(props.yLabel),
  };

  const check = checkType(type, p);
  if (check) {
    return {
      ok: false,
      reason: `validator: ${check}`,
      fallback: tableFallback,
    };
  }

  const spec: ChartSpec = {
    type,
    title: asString(obj.title),
    props: p,
    narrativeFocus: asString(obj.narrativeFocus),
  };
  return { ok: true, spec };
}

function checkType(type: ChartType, p: ChartProps): string | null {
  const n = p.data.length;
  switch (type) {
    case "line":
    case "area":
      if (!p.xKey) return "missing xKey";
      if (!p.yKey) return "missing yKey";
      if (n < 3) return `${type} requires ≥ 3 points (got ${n})`;
      return null;
    case "stacked_area":
      if (!p.xKey) return "missing xKey";
      if (!p.seriesKeys || p.seriesKeys.length < 2)
        return "stacked_area requires ≥ 2 seriesKeys";
      if (n < 3) return `stacked_area requires ≥ 3 points (got ${n})`;
      return null;
    case "bar":
      if (!p.xKey) return "missing xKey";
      if (!p.yKey) return "missing yKey";
      if (n === 0) return "bar requires data";
      if (n > 30) return `bar with > 30 categories (got ${n}) — prefer table`;
      return null;
    case "stacked_bar":
    case "grouped_bar":
      if (!p.xKey) return "missing xKey";
      if (!p.seriesKeys || p.seriesKeys.length < 2)
        return `${type} requires ≥ 2 seriesKeys`;
      if (n === 0) return `${type} requires data`;
      return null;
    case "pie":
      if (!p.nameKey) return "missing nameKey";
      if (!p.valueKey) return "missing valueKey";
      if (n < 2) return `pie requires 2–8 slices (got ${n})`;
      if (n > 8) return `pie requires 2–8 slices (got ${n})`;
      return null;
    case "scatter":
      if (!p.xKey) return "missing xKey";
      if (!p.yKey) return "missing yKey";
      if (n < 5) return `scatter requires ≥ 5 points (got ${n})`;
      return null;
    case "bubble":
      if (!p.xKey) return "missing xKey";
      if (!p.yKey) return "missing yKey";
      if (!p.sizeKey) return "missing sizeKey";
      if (n < 5) return `bubble requires ≥ 5 points (got ${n})`;
      return null;
    case "kpi":
      if (p.value === undefined || p.value === null)
        return "kpi requires value";
      return null;
    case "table":
      if (!p.columns || p.columns.length === 0) return "table requires columns";
      return null;
    case "histogram":
      if (!p.xKey) return "missing xKey (bin label)";
      if (!p.yKey) return "missing yKey (count)";
      if (n === 0) return "histogram requires data";
      return null;
    case "heatmap":
      if (!p.rowKey) return "missing rowKey";
      if (!p.colKey) return "missing colKey";
      if (!p.intensityKey) return "missing intensityKey";
      if (n < 9) return `heatmap requires ≥ 3×3 grid (got ${n})`;
      return null;
    case "funnel":
      if (!p.labelKey) return "missing labelKey";
      if (!p.valueKey) return "missing valueKey";
      if (n < 3) return `funnel requires ≥ 3 stages (got ${n})`;
      return null;
    case "treemap":
      if (!p.nameKey) return "missing nameKey";
      if (!p.valueKey) return "missing valueKey";
      if (n === 0) return "treemap requires data";
      return null;
    case "radar":
      if (!p.axes || p.axes.length < 4)
        return `radar requires ≥ 4 axes (got ${p.axes?.length ?? 0})`;
      if (n === 0) return "radar requires data";
      return null;
    case "gauge":
      if (p.value === undefined || p.value === null)
        return "gauge requires value";
      if (p.target === undefined) return "gauge requires target";
      return null;
    case "waterfall":
      if (!p.labelKey) return "missing labelKey";
      if (!p.deltaKey) return "missing deltaKey";
      if (n < 3) return `waterfall requires ≥ 3 steps (got ${n})`;
      return null;
  }
}

function buildTableFallback(
  rows: Array<Record<string, unknown>>
): ChartSpec {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return {
    type: "table",
    props: { data: rows, columns },
  };
}

// ─── coercion helpers ───────────────────────────────────────────────────

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function asPrimitive(v: unknown): string | number | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = (v as unknown[]).filter(
    (x): x is string => typeof x === "string"
  );
  return out.length > 0 ? out : undefined;
}
