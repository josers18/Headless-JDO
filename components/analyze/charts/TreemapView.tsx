"use client";

import { ResponsiveContainer, Tooltip, Treemap } from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import { seriesColor, TOOLTIP_STYLES } from "./chartTheme";

export function TreemapView({ props }: { props: ChartProps }) {
  const { data, nameKey, valueKey } = props;
  if (!nameKey || !valueKey) return null;
  const rows = data.map((d, i) => ({
    ...d,
    __fill: seriesColor(i),
  }));
  return (
    <ResponsiveContainer width="100%" height={320}>
      <Treemap
        data={rows}
        dataKey={valueKey}
        nameKey={nameKey}
        stroke="var(--hz-bg)"
        fill="var(--hz-chart-1)"
        animationDuration={280}
        content={(node) => <TreemapCell node={node} />}
      >
        <Tooltip {...TOOLTIP_STYLES} />
      </Treemap>
    </ResponsiveContainer>
  );
}

type TreemapContentNode = {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  __fill?: string;
  value?: number;
};

function TreemapCell({ node }: { node: unknown }) {
  const n = node as TreemapContentNode;
  if (!n || typeof n.x !== "number") return null;
  const color = n.__fill ?? "var(--hz-chart-1)";
  return (
    <g>
      <rect
        x={n.x}
        y={n.y}
        width={n.width}
        height={n.height}
        fill={color}
        stroke="var(--hz-bg)"
      />
      {n.width > 60 && n.height > 24 && (
        <text
          x={n.x + 8}
          y={n.y + 18}
          fill="var(--hz-bg)"
          fontSize={11}
          fontWeight={500}
        >
          {n.name}
        </text>
      )}
    </g>
  );
}
