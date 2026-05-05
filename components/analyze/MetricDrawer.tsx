"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import type { SemanticModelMetricDefinition } from "@/lib/analyze/types";

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; definition: SemanticModelMetricDefinition }
  | { kind: "error"; message: string };

/**
 * Right-side slide-in (Q-T2-5-b = A) showing the governed definition of
 * a metric referenced by the assistant's narrative. Curated 5 fields by
 * default, "Show raw" toggle for audit (Q-T2-5-c = C).
 *
 * Closes on Esc, click-outside (the overlay), or the X button. Fetches
 * the full definition on open from /api/analyze-models/[id]/metrics/[apiName].
 */
export function MetricDrawer({
  modelId,
  metricApiName,
  metricLabel,
  onClose,
}: {
  modelId: string;
  metricApiName: string;
  metricLabel: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [showRaw, setShowRaw] = useState(false);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(
        `/api/analyze-models/${encodeURIComponent(modelId)}/metrics/${encodeURIComponent(metricApiName)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Definition unavailable (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as {
        definition: SemanticModelMetricDefinition;
      };
      setState({ kind: "ready", definition: data.definition });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Load failed",
      });
    }
  }, [modelId, metricApiName]);

  useEffect(() => {
    void load();
  }, [load]);

  // Esc to close. Scoped to drawer lifecycle.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock body scroll while the drawer is open so the main column
  // doesn't scroll behind it on wheel events.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex"
      role="dialog"
      aria-modal="true"
      aria-labelledby="metric-drawer-title"
    >
      {/* Overlay (click to close) */}
      <button
        type="button"
        onClick={onClose}
        className="flex-1 bg-black/50 backdrop-blur-sm"
        aria-label="Close"
      />

      {/* Drawer panel */}
      <aside className="flex w-full max-w-[480px] flex-col border-l border-border-soft bg-bg shadow-[0_30px_80px_-20px_rgba(0,0,0,0.5)] animate-slide-in-right">
        <header className="flex items-start justify-between gap-3 border-b border-border-soft/60 px-6 py-5">
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
              Governed metric
            </div>
            <h2
              id="metric-drawer-title"
              className="mt-1 font-display text-xl tracking-tight text-text"
              title={metricLabel}
            >
              {metricLabel}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition hover:bg-surface2 hover:text-text"
            aria-label="Close drawer"
          >
            <X size={16} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {state.kind === "loading" && (
            <div className="text-[13px] text-text-muted">
              Loading definition…
            </div>
          )}

          {state.kind === "error" && (
            <div className="flex flex-col items-start gap-3 text-[13px] text-text-muted">
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

          {state.kind === "ready" && (
            <CuratedDefinition
              definition={state.definition}
              showRaw={showRaw}
              onToggleRaw={() => setShowRaw((v) => !v)}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function CuratedDefinition({
  definition,
  showRaw,
  onToggleRaw,
}: {
  definition: SemanticModelMetricDefinition;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* Description */}
      <Section label="Description">
        {definition.description ? (
          <p className="text-[14px] leading-relaxed text-text">
            {definition.description}
          </p>
        ) : (
          <p className="text-[13px] text-text-muted">
            No description provided by the SDM author.
          </p>
        )}
      </Section>

      {/* Formula (derived from aggregation + source field) */}
      <Section label="Formula">
        {definition.aggregationType && definition.sourceField ? (
          <code className="block rounded-md bg-surface2 px-3 py-2 text-[12px] text-text">
            {definition.aggregationType}({definition.sourceField})
            {definition.isCumulative ? "  (cumulative)" : ""}
          </code>
        ) : (
          <p className="text-[13px] text-text-muted">Formula not available.</p>
        )}
      </Section>

      {/* Data source */}
      <Section label="Data source">
        {definition.sourceTable ? (
          <code className="block rounded-md bg-surface2 px-3 py-2 text-[12px] text-text">
            {definition.sourceTable}
            {definition.sourceField ? `.${definition.sourceField}` : ""}
          </code>
        ) : (
          <p className="text-[13px] text-text-muted">Source not available.</p>
        )}
      </Section>

      {/* Time grains */}
      <Section label="Supported time grains">
        {definition.timeGrains && definition.timeGrains.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {definition.timeGrains.map((g) => (
              <span
                key={g}
                className="rounded-md border border-border-soft bg-surface/60 px-2 py-0.5 text-[11px] text-text-muted"
              >
                {g}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-text-muted">
            No explicit time grains set.
          </p>
        )}
      </Section>

      {/* Last updated */}
      <Section label="Last modified">
        {definition.lastModifiedDate ? (
          <p className="text-[13px] text-text">
            {new Date(definition.lastModifiedDate).toLocaleDateString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </p>
        ) : (
          <p className="text-[13px] text-text-muted">Unknown.</p>
        )}
      </Section>

      {/* Raw toggle */}
      <div className="mt-2">
        <button
          type="button"
          onClick={onToggleRaw}
          className="text-[12px] text-text-muted transition hover:text-text"
        >
          {showRaw ? "Hide raw definition" : "Show raw definition"}
        </button>
        {showRaw && (
          <pre className="mt-3 max-h-[50vh] overflow-auto rounded-lg border border-border-soft/60 bg-surface2/60 p-3 text-[11px] leading-relaxed text-text-muted">
            {JSON.stringify(definition.raw, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        {label}
      </div>
      {children}
    </section>
  );
}
