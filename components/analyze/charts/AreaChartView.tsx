"use client";

import {
  Area,
  AreaChart,
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

export function AreaChartView({
  type,
  props,
}: {
  type: ChartType;
  props: ChartProps;
}) {
  const { data, xKey, yKey, seriesKeys } = props;
  const keys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : yKey ? [yKey] : [];
  const stacked = type === "stacked_area";
  return (
    <ResponsiveContainer width="100%" height={320}>
      <AreaChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
        <defs>
          {keys.map((k, i) => {
            const c = seriesColor(i);
            return (
              <linearGradient key={k} id={`hz-area-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={c} stopOpacity={0.45} />
                <stop offset="100%" stopColor={c} stopOpacity={0.05} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
        <XAxis dataKey={xKey} {...AXIS_PROPS} />
        <YAxis {...AXIS_PROPS} />
        <Tooltip {...TOOLTIP_STYLES} />
        {keys.length > 1 && <Legend {...LEGEND_PROPS} />}
        {keys.map((k, i) => (
          <Area
            key={k}
            type="monotone"
            dataKey={k}
            stroke={seriesColor(i)}
            fill={`url(#hz-area-${i})`}
            strokeWidth={2}
            stackId={stacked ? "1" : undefined}
            animationDuration={280}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
