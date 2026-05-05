"use client";

import { useState } from "react";
import { BookOpenText } from "lucide-react";
import type { SemanticModelMetric } from "@/lib/analyze/types";
import { MetricDrawer } from "./MetricDrawer";

/**
 * "Used in this answer" chip row. Rendered below the narrative/chart
 * when string-match found named metrics in the assistant's prose.
 * Clicking a chip opens the governance drawer (T2-5).
 *
 * Local state handles which chip is open — the drawer is a portal-ish
 * sibling in the DOM tree, so this stays a pure client component.
 */
export function MetricChips({
  modelId,
  metrics,
}: {
  modelId: string;
  metrics: readonly SemanticModelMetric[];
}) {
  const [openMetric, setOpenMetric] = useState<SemanticModelMetric | null>(
    null
  );

  if (metrics.length === 0) return null;

  return (
    <section className="mt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        <BookOpenText size={11} />
        Used in this answer
      </div>
      <div className="flex flex-wrap gap-2">
        {metrics.map((m) => (
          <button
            key={m.apiName}
            type="button"
            onClick={() => setOpenMetric(m)}
            className="group flex items-center gap-1.5 rounded-full border border-border-soft bg-surface/60 px-3 py-1.5 text-[12px] text-text-muted transition hover:border-accent/50 hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:border-accent focus-visible:text-text"
            title={`Open definition for ${m.label}`}
          >
            <span>{m.label}</span>
            <span
              className="text-[9px] uppercase tracking-[0.18em] opacity-60 group-hover:opacity-100"
              aria-hidden
            >
              def →
            </span>
          </button>
        ))}
      </div>

      {openMetric && (
        <MetricDrawer
          modelId={modelId}
          metricApiName={openMetric.apiName}
          metricLabel={openMetric.label}
          onClose={() => setOpenMetric(null)}
        />
      )}
    </section>
  );
}
