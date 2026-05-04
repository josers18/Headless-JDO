"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import { LEGEND_PROPS, seriesColor, TOOLTIP_STYLES } from "./chartTheme";

export function PieChartView({ props }: { props: ChartProps }) {
  const { data, nameKey, valueKey } = props;
  if (!nameKey || !valueKey) return null;
  return (
    <ResponsiveContainer width="100%" height={320}>
      <PieChart margin={{ top: 16, right: 16, left: 16, bottom: 16 }}>
        <Tooltip {...TOOLTIP_STYLES} />
        <Legend {...LEGEND_PROPS} />
        <Pie
          data={data}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          outerRadius={110}
          strokeWidth={1}
          stroke="var(--hz-bg)"
          animationDuration={280}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={seriesColor(i)} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}
