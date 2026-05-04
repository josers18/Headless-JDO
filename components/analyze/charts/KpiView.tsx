"use client";

import type { ChartProps } from "@/lib/analyze/chartTypes";

/**
 * KPI hero: a single big number with optional unit + delta-vs-previous.
 * No Recharts — pure typography.
 */
export function KpiView({ props }: { props: ChartProps }) {
  const { value, previousValue, unit } = props;

  const current = typeof value === "number" ? value : parseMaybeNumber(value);
  const prev =
    typeof previousValue === "number"
      ? previousValue
      : parseMaybeNumber(previousValue);

  let deltaText: string | null = null;
  let deltaDirection: "up" | "down" | null = null;
  if (current != null && prev != null && prev !== 0) {
    const pct = ((current - prev) / Math.abs(prev)) * 100;
    deltaDirection = pct >= 0 ? "up" : "down";
    const sign = pct >= 0 ? "↑" : "↓";
    deltaText = `${sign} ${Math.abs(pct).toFixed(1)}%`;
  }

  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-border-soft/60 bg-surface/30 px-6 py-8">
      <div className="flex items-baseline gap-2">
        <span className="font-display text-5xl tracking-tight text-text">
          {formatDisplay(value)}
        </span>
        {unit && (
          <span className="text-[14px] text-text-muted">{unit}</span>
        )}
      </div>
      {deltaText && (
        <div
          className={
            "text-[12px] " +
            (deltaDirection === "up" ? "text-success" : "text-danger")
          }
        >
          {deltaText}{" "}
          <span className="text-text-muted">
            vs {formatDisplay(previousValue)}
          </span>
        </div>
      )}
    </div>
  );
}

function parseMaybeNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatDisplay(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    const abs = Math.abs(v);
    if (abs >= 1_000_000_000)
      return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  }
  return String(v);
}
