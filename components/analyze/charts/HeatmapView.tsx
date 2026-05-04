"use client";

import { useMemo } from "react";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import { CHART_GRID } from "./chartTheme";

/**
 * Heatmap — not a native Recharts component. Implemented as SVG rects
 * on a grid keyed by (rowKey, colKey) with intensity mapped to the
 * --hz-chart-heat-low → --hz-chart-heat-high gradient.
 */
export function HeatmapView({ props }: { props: ChartProps }) {
  const { data, rowKey, colKey, intensityKey } = props;
  const grid = useMemo(() => {
    if (!rowKey || !colKey || !intensityKey) return null;
    const rows = new Set<string>();
    const cols = new Set<string>();
    const cells = new Map<string, number>();
    let min = Infinity;
    let max = -Infinity;
    for (const d of data) {
      const r = asString(d[rowKey]);
      const c = asString(d[colKey]);
      const v = asNumber(d[intensityKey]);
      if (r == null || c == null || v == null) continue;
      rows.add(r);
      cols.add(c);
      cells.set(`${r}|${c}`, v);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (rows.size === 0 || cols.size === 0) return null;
    return {
      rows: [...rows],
      cols: [...cols],
      cells,
      min,
      max,
    };
  }, [data, rowKey, colKey, intensityKey]);

  if (!grid) return null;

  const cellW = 72;
  const cellH = 32;
  const labelW = 120;
  const labelH = 28;
  const width = labelW + grid.cols.length * cellW;
  const height = labelH + grid.rows.length * cellH;

  function intensity01(v: number): number {
    if (grid!.max === grid!.min) return 0.5;
    return (v - grid!.min) / (grid!.max - grid!.min);
  }

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Heatmap">
        {/* Column headers */}
        {grid.cols.map((c, i) => (
          <text
            key={`col-${c}`}
            x={labelW + i * cellW + cellW / 2}
            y={labelH - 8}
            textAnchor="middle"
            fill="var(--hz-text-muted)"
            fontSize={11}
          >
            {truncate(c, 10)}
          </text>
        ))}
        {/* Row headers */}
        {grid.rows.map((r, i) => (
          <text
            key={`row-${r}`}
            x={labelW - 8}
            y={labelH + i * cellH + cellH / 2 + 4}
            textAnchor="end"
            fill="var(--hz-text-muted)"
            fontSize={11}
          >
            {truncate(r, 16)}
          </text>
        ))}
        {/* Cells */}
        {grid.rows.map((r, ri) =>
          grid.cols.map((c, ci) => {
            const v = grid.cells.get(`${r}|${c}`);
            const t = v != null ? intensity01(v) : 0;
            const bg = `color-mix(in oklch, var(--hz-chart-heat-low) ${((1 - t) * 100).toFixed(0)}%, var(--hz-chart-heat-high) ${(t * 100).toFixed(0)}%)`;
            return (
              <g key={`${r}|${c}`}>
                <rect
                  x={labelW + ci * cellW + 2}
                  y={labelH + ri * cellH + 2}
                  width={cellW - 4}
                  height={cellH - 4}
                  fill={v == null ? "var(--hz-surface2)" : bg}
                  stroke={CHART_GRID}
                  strokeWidth={0.5}
                  rx={3}
                >
                  <title>{`${r} × ${c}: ${v ?? "—"}`}</title>
                </rect>
                {v != null && (
                  <text
                    x={labelW + ci * cellW + cellW / 2}
                    y={labelH + ri * cellH + cellH / 2 + 4}
                    textAnchor="middle"
                    fill={t > 0.55 ? "var(--hz-bg)" : "var(--hz-text)"}
                    fontSize={10}
                  >
                    {formatNumber(v)}
                  </text>
                )}
              </g>
            );
          })
        )}
      </svg>
    </div>
  );
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}
function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function formatNumber(v: number): string {
  if (Math.abs(v) >= 1000) return (v / 1000).toFixed(1) + "K";
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
