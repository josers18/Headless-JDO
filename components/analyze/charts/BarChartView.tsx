"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartProps, ChartType } from "@/lib/analyze/chartTypes";
import {
  AXIS_PROPS,
  axisTickFormatter,
  CHART_AXIS,
  chartValueFormatter,
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
        <YAxis {...AXIS_PROPS} tickFormatter={axisTickFormatter} />
        <Tooltip {...TOOLTIP_STYLES} formatter={(v: unknown) => chartValueFormatter(v)} />
        {keys.length > 1 && <Legend {...LEGEND_PROPS} />}
        {keys.map((k, i) => (
          <Bar
            key={k}
            dataKey={k}
            fill={seriesColor(i)}
            stackId={stacked ? "1" : undefined}
            radius={stacked || keys.length > 1 ? [0, 0, 0, 0] : [4, 4, 0, 0]}
            animationDuration={280}
          >
            {/* On-bar value labels — K/M/B-formatted. Single-series
                bars get labels above the bar; stacked/grouped skip to
                avoid overlap (tooltip covers those cases). */}
            {keys.length === 1 && !stacked && (
              <LabelList
                dataKey={k}
                position="top"
                formatter={chartValueFormatter}
                fill={CHART_AXIS}
                fontSize={11}
              />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
