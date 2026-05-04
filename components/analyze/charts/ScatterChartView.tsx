"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import type { ChartProps, ChartType } from "@/lib/analyze/chartTypes";
import {
  AXIS_PROPS,
  CHART_GRID,
  seriesColor,
  TOOLTIP_STYLES,
} from "./chartTheme";

/**
 * Scatter + bubble. Bubble sizes points by `sizeKey`; scatter uses
 * constant radius.
 */
export function ScatterChartView({
  type,
  props,
}: {
  type: ChartType;
  props: ChartProps;
}) {
  const { data, xKey, yKey, sizeKey } = props;
  if (!xKey || !yKey) return null;
  const isBubble = type === "bubble" && Boolean(sizeKey);
  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 16, right: 16, left: 4, bottom: 8 }}>
        <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
        <XAxis type="number" dataKey={xKey} name={xKey} {...AXIS_PROPS} />
        <YAxis type="number" dataKey={yKey} name={yKey} {...AXIS_PROPS} />
        {isBubble && sizeKey && (
          <ZAxis type="number" dataKey={sizeKey} range={[40, 360]} name={sizeKey} />
        )}
        <Tooltip
          {...TOOLTIP_STYLES}
          cursor={{ strokeDasharray: "3 3", stroke: "var(--hz-chart-grid)" }}
        />
        <Scatter
          data={data}
          fill={seriesColor(0)}
          animationDuration={280}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
