"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { SemanticModelMetric } from "@/lib/analyze/types";
import { dispatchAnalyzeAskBarFill } from "./analyzeEvents";

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; metrics: SemanticModelMetric[] }
  | { kind: "error"; message: string };

/**
 * Named-metric pills for the selected SDM. Fetches client-side per
 * Q-T2-2-a = C so the page can stream server-rendered profile fast
 * without blocking on this slower call.
 *
 * Clicking a pill in T2-2 is a no-op — T2-3 wires it to pre-fill the
 * Ask bar once that lands.
 */
export function ModelMetricsPills({ modelId }: { modelId: string }) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/analyze-models/${encodeURIComponent(modelId)}/metrics`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Metrics unavailable (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as { metrics: SemanticModelMetric[] };
      setState({ kind: "ready", metrics: data.metrics ?? [] });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Load failed",
      });
    }
  }, [modelId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="mt-8">
      <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        Named metrics
      </div>

      {state.kind === "loading" && (
        <div className="text-[13px] text-text-muted">Loading metrics…</div>
      )}

      {state.kind === "error" && (
        <div className="flex items-center gap-3 text-[13px] text-text-muted">
          <span className="text-danger/90">{state.message}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-md border border-border-soft px-2 py-1 text-[11px] transition hover:border-accent/50 hover:text-text"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {state.kind === "ready" && state.metrics.length === 0 && (
        <p className="max-w-xl text-[13px] text-text-muted">
          No named metrics on this model. You can still ask analytical
          questions in natural language — the agent will compose measures
          and dimensions from the underlying data objects.
        </p>
      )}

      {state.kind === "ready" && state.metrics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {state.metrics.map((m) => (
            <button
              key={m.apiName}
              type="button"
              onClick={() =>
                dispatchAnalyzeAskBarFill(
                  `Show me ${m.label} over the last 6 months`
                )
              }
              className="rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-left text-[13px] text-text-muted transition hover:border-accent/50 hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:border-accent focus-visible:text-text"
              title={m.description ?? `Click to ask about ${m.label}`}
              aria-label={`Ask about ${m.label}`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
