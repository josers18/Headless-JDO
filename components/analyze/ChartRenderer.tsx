"use client";

import type { ChartSpec } from "@/lib/analyze/chartTypes";
import { AreaChartView } from "./charts/AreaChartView";
import { BarChartView } from "./charts/BarChartView";
import { FunnelView } from "./charts/FunnelView";
import { GaugeView } from "./charts/GaugeView";
import { HeatmapView } from "./charts/HeatmapView";
import { KpiView } from "./charts/KpiView";
import { LineChartView } from "./charts/LineChartView";
import { PieChartView } from "./charts/PieChartView";
import { RadarView } from "./charts/RadarView";
import { ScatterChartView } from "./charts/ScatterChartView";
import { TableView } from "./charts/TableView";
import { TreemapView } from "./charts/TreemapView";
import { WaterfallView } from "./charts/WaterfallView";

/**
 * Single dispatcher for all 18 chart types. Any chart that the
 * validator-approved spec says to render routes through here. If a
 * renderer returns null (e.g., data is missing a required prop
 * despite passing validation), we fall back to TableView so the
 * banker always sees something.
 */
export function ChartRenderer({ spec }: { spec: ChartSpec }) {
  const rendered = renderByType(spec);
  if (rendered) return <Framed spec={spec}>{rendered}</Framed>;
  // Last-resort fallback — mostly defensive.
  return (
    <Framed spec={spec}>
      <TableView
        props={{
          data: spec.props.data,
          columns:
            spec.props.columns ??
            (spec.props.data[0] ? Object.keys(spec.props.data[0]) : []),
        }}
      />
    </Framed>
  );
}

function renderByType(spec: ChartSpec) {
  const { type, props } = spec;
  switch (type) {
    case "line":
      return <LineChartView props={props} />;
    case "area":
    case "stacked_area":
      return <AreaChartView type={type} props={props} />;
    case "bar":
    case "stacked_bar":
    case "grouped_bar":
    case "histogram":
      return <BarChartView type={type} props={props} />;
    case "pie":
      return <PieChartView props={props} />;
    case "scatter":
    case "bubble":
      return <ScatterChartView type={type} props={props} />;
    case "kpi":
      return <KpiView props={props} />;
    case "table":
      return <TableView props={props} />;
    case "heatmap":
      return <HeatmapView props={props} />;
    case "funnel":
      return <FunnelView props={props} />;
    case "treemap":
      return <TreemapView props={props} />;
    case "radar":
      return <RadarView props={props} />;
    case "gauge":
      return <GaugeView props={props} />;
    case "waterfall":
      return <WaterfallView props={props} />;
  }
}

function Framed({
  spec,
  children,
}: {
  spec: ChartSpec;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3 rounded-lg border border-border-soft/60 bg-surface/20 p-4">
      {spec.title && (
        <h4 className="mb-3 text-[13px] font-medium text-text">
          {spec.title}
        </h4>
      )}
      {children}
    </section>
  );
}
