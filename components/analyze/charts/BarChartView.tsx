"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartProps, ChartType } from "@/lib/analyze/chartTypes";
import {
  AXIS_PROPS,
  CHART_GRID,
  LEGEND_PROPS,
  seriesColor,
  TOOLTIP_STYLES,
} from "./chartTheme";

/**
 * Handles bar / stacked_bar / grouped_bar / histogram.
 *   - bar / histogram: single series (`yKey`)
 *   - stacked_bar: seriesKeys stacked on same axis (stackId="1")
 *   - grouped_bar: seriesKeys side-by-side (no stackId)
 */
export function BarChartView({
  type,
  props,
}: {
  type: ChartType;
  props: ChartProps;
}) {
  const { data, xKey, yKey, seriesKeys } = props;
  const keys =
    seriesKeys && seriesKeys.length > 0
      ? seriesKeys
      : yKey
        ? [yKey]
        : [];

  const stacked = type === "stacked_bar";
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip {...TOOLTIP_STYLES} />
        {keys.length > 1 && <Legend {...LEGEND_PROPS} />}
        {keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            fill={seriesColor(i)}
            stackId={stacked ? "1" : undefined}
            radius={stacked || keys.length > 1 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            animationDuration={280}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
