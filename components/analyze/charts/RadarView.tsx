"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { ChartProps } from "@/lib/analyze/chartTypes";
import {
  CHART_AXIS,
  CHART_GRID,
  LEGEND_PROPS,
  seriesColor,
  TOOLTIP_STYLES,
} from "./chartTheme";

/**
 * Radar needs data shaped as `[{ axis: "metric-1", value: 4 }, ...]`.
 * Callers pass `axes` (the numeric field names on each row) plus rows
 * that are either pre-pivoted (one row per axis) or per-entity rows
 * where each axis is a column. We reshape to the pivoted form here.
 */
export function RadarView({ props }: { props: ChartProps }) {
  const { data, axes, nameKey, valueKey } = props;
  if (!axes || axes.length === 0) return null;

  // If rows already have { axis, value } shape, use as-is.
  const firstRow = data[0];
  const prePivoted =
    firstRow &&
    nameKey &&
    valueKey &&
    nameKey in firstRow &&
    valueKey in firstRow;

  const chartData = prePivoted
    ? data
    : axes.map((a) => {
        const row: Record<string, unknown> = { axis: a };
        data.forEach((d, i) => {
          const entityName = asString(nameKey ? d[nameKey] : undefined) ?? `Series ${i + 1}`;
          row[entityName] = d[a];
        });
        return row;
      });

  const seriesNames = prePivoted
    ? [valueKey!]
    : data.map((d, i) =>
        asString(nameKey ? d[nameKey] : undefined) ?? `Series ${i + 1}`
      );

  return (
    <ResponsiveContainer width="100%" height={320}>
      <RadarChart data={chartData} margin={{ top: 16, right: 16, left: 16, bottom: 8 }}>
        <PolarGrid stroke={CHART_GRID} />
        <PolarAngleAxis
          dataKey={prePivoted ? nameKey : "axis"}
          tick={{ fill: CHART_AXIS, fontSize: 11 }}
        />
        <PolarRadiusAxis tick={{ fill: CHART_AXIS, fontSize: 10 }} axisLine={false} />
        <Tooltip {...TOOLTIP_STYLES} />
        {seriesNames.length > 1 && <Legend {...LEGEND_PROPS} />}
        {seriesNames.map((name, i) => (
          <Radar
            key={name}
            name={name}
            dataKey={name}
            stroke={seriesColor(i)}
            fill={seriesColor(i)}
            fillOpacity={0.3}
            animationDuration={280}
          />
        ))}
      </RadarChart>
    </ResponsiveContainer>
  );
}

function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}
