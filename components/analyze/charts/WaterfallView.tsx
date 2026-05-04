"use client";

import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import { AXIS_PROPS, CHART_GRID, TOOLTIP_STYLES } from "./chartTheme";

/**
 * Waterfall — built from a stacked bar where one segment is invisible
 * (the "accumulator") and the other is the delta. Recharts supports
 * this natively once data is pre-processed into {label, base, delta}
 * rows.
 */
export function WaterfallView({ props }: { props: ChartProps }) {
  const { data, labelKey, deltaKey } = props;
  const computed = useMemo(() => {
    if (!labelKey || !deltaKey) return [];
    let running = 0;
    return data.map((d) => {
      const delta = toNumber(d[deltaKey]) ?? 0;
      const base = delta >= 0 ? running : running + delta;
      const magnitude = Math.abs(delta);
      running += delta;
      return {
        label: String(d[labelKey] ?? ""),
        base,
        delta: magnitude,
        sign: delta >= 0 ? "up" : "down",
      };
    });
  }, [data, labelKey, deltaKey]);

  if (computed.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={computed} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip
          {...TOOLTIP_STYLES}
          formatter={(_, __, item) => {
            const row = item?.payload as { delta: number; sign: string };
            return [
              (row.sign === "up" ? "+" : "-") + row.delta.toLocaleString(),
              "Delta",
            ];
          }}
        />
        {/* Invisible base bar to push delta up to its starting point */}
        <Bar dataKey="base" stackId="wf" fill="transparent" />
        <Bar
          dataKey="delta"
          stackId="wf"
          animationDuration={280}
          radius={[3, 3, 0, 0]}
        >
          {computed.map((r, i) => (
            <Cell
              key={i}
              fill={
                r.sign === "up"
                  ? "var(--hz-success)"
                  : "var(--hz-danger)"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
