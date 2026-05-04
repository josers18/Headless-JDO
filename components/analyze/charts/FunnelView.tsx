"use client";

import {
  Funnel,
  FunnelChart,
  LabelList,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import { seriesColor, TOOLTIP_STYLES } from "./chartTheme";

export function FunnelView({ props }: { props: ChartProps }) {
  const { data, labelKey, valueKey } = props;
  if (!labelKey || !valueKey) return null;
  const withColors = data.map((d, i) => ({ ...d, fill: seriesColor(i) }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <FunnelChart margin={{ top: 16, right: 16, left: 16, bottom: 16 }}>
        <Tooltip {...TOOLTIP_STYLES} />
        <Funnel
          dataKey={valueKey}
          data={withColors}
          nameKey={labelKey}
          isAnimationActive
          animationDuration={280}
        >
          <LabelList
            position="right"
            dataKey={labelKey}
            fill="var(--hz-text-muted)"
            fontSize={11}
          />
        </Funnel>
      </FunnelChart>
    </ResponsiveContainer>
  );
}
