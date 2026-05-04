"use client";

import type { ChartProps } from "@/lib/analyze/chartTypes";
import { seriesColor } from "./chartTheme";

/**
 * Semicircle gauge — minimal custom SVG, no Recharts. Renders progress
 * from 0 to `target`. If value exceeds target, the arc caps at target.
 */
export function GaugeView({ props }: { props: ChartProps }) {
  const value = toNumber(props.value);
  const target = props.target;
  if (value == null || target == null || target <= 0) return null;

  const pct = Math.max(0, Math.min(1, value / target));
  const capped = value > target;

  const width = 320;
  const height = 200;
  const cx = width / 2;
  const cy = height - 16;
  const r = 120;

  const endAngle = 180 - pct * 180;
  const start = polar(cx, cy, r, 180);
  const end = polar(cx, cy, r, endAngle);
  const largeArc = pct > 0.5 ? 1 : 0;

  const bgStart = polar(cx, cy, r, 180);
  const bgEnd = polar(cx, cy, r, 0);

  return (
    <div className="flex flex-col items-center rounded-lg border border-border-soft/60 bg-surface/30 px-6 py-6">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Gauge: ${value} of ${target}`}
      >
        {/* Background arc */}
        <path
          d={`M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 0 1 ${bgEnd.x} ${bgEnd.y}`}
          fill="none"
          stroke="var(--hz-chart-grid)"
          strokeWidth={16}
          strokeLinecap="round"
        />
        {/* Progress arc */}
        {pct > 0 && (
          <path
            d={`M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`}
            fill="none"
            stroke={seriesColor(capped ? 1 : 0)}
            strokeWidth={16}
            strokeLinecap="round"
          />
        )}
        {/* Center label */}
        <text
          x={cx}
          y={cy - 40}
          textAnchor="middle"
          fill="var(--hz-text)"
          fontSize={36}
          fontWeight={500}
        >
          {formatNumber(value)}
          {props.unit && (
            <tspan fill="var(--hz-text-muted)" fontSize={14}> {props.unit}</tspan>
          )}
        </text>
        <text
          x={cx}
          y={cy - 16}
          textAnchor="middle"
          fill="var(--hz-text-muted)"
          fontSize={12}
        >
          of {formatNumber(target)} ({(pct * 100).toFixed(0)}%)
        </text>
      </svg>
    </div>
  );
}

function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad) * -1 * -1, y: cy - r * Math.sin(rad) };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatNumber(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return v.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
