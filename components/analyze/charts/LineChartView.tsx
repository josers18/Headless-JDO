"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import {
  AXIS_PROPS,
  CHART_GRID,
  LEGEND_PROPS,
  seriesColor,
  TOOLTIP_STYLES,
} from "./chartTheme";

export function LineChartView({ props }: { props: ChartProps }) {
  const { data, xKey, yKey, seriesKeys, xLabel, yLabel } = props;
  const keys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : yKey ? [yKey] : [];
  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data} margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
        <XAxis
          dataKey={xKey}
          {...AXIS_PROPS}
          label={xLabel ? { value: xLabel, position: "insideBottom", offset: -4, fill: "var(--hz-text-muted)", fontSize: 11 } : undefined}
        />
        <YAxis
          {...AXIS_PROPS}
          label={yLabel ? { value: yLabel, angle: -90, position: "insideLeft", fill: "var(--hz-text-muted)", fontSize: 11 } : undefined}
        />
        <Tooltip {...TOOLTIP_STYLES} />
        {keys.length > 1 && <Legend {...LEGEND_PROPS} />}
        {keys.map((k, i) => (
          <Line
            key={k}
            type="monotone"
            dataKey={k}
            stroke={seriesColor(i)}
            strokeWidth={2}
            dot={{ r: 3, fill: seriesColor(i), strokeWidth: 0 }}
            activeDot={{ r: 5, fill: seriesColor(i) }}
            animationDuration={280}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
