"use client";

import { Check, Loader2, X } from "lucide-react";
import type { DraftAction } from "@/types/horizon";
import type { PrepBriefingPayload } from "@/lib/client/prepDraft";
import { draftFromPrepStep } from "@/lib/client/prepDraft";
/** Matches AskBar InlineActionStatus (incl. dismissed for shared action map) */
type PrepRowStatus =
  | { kind: "idle" }
  | { kind: "executing" }
  | { kind: "done"; recordId?: string }
  | { kind: "error"; message: string }
  | { kind: "dismissed" };

/**
 * Renders streamed prep JSON as scannable sections + executable next steps
 * (same /api/actions path as Pre-drafted actions).
 */
export function PrepBriefingPanel({
  payload,
  clientId,
  actionStatus,
  onExecute,
}: {
  payload: PrepBriefingPayload;
  clientId: string;
  actionStatus: Record<string, PrepRowStatus>;
  onExecute: (d: DraftAction) => void | Promise<void>;
}) {
  const sources = payload.sources_used?.length
    ? payload.sources_used
    : [];

  return (
    <div className="mt-4 space-y-6 text-left">
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
          Situation
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-text">
          {payload.situation}
        </p>
      </section>
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
          Why it matters
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
          {payload.why_it_matters}
        </p>
      </section>

      {payload.next_steps?.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.2em] text-text-muted">
            Next steps
          </h3>
          <ul className="mt-3 space-y-3">
            {payload.next_steps.map((step, i) => {
              const draft = draftFromPrepStep(step, clientId, i);
              const st = actionStatus[draft.id] ?? { kind: "idle" as const };
              if (st.kind === "dismissed") return null;
              return (
                <li
                  key={`${draft.id}-${i}`}
                  className="rounded-xl border border-accent/25 bg-accent/5 px-4 py-3"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-accent">
                    <span>{step.kind}</span>
                  </div>
                  <div className="mt-1 text-[14px] font-medium text-text">
                    {step.label}
                  </div>
                  <p className="mt-1 text-[13px] leading-snug text-text-muted">
                    {step.detail}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border-soft/60 pt-3">
                    {st.kind === "idle" && (
                      <button
                        type="button"
                        onClick={() => void onExecute(draft)}
                        className="group/approve relative flex min-h-[44px] items-center gap-2 overflow-hidden rounded-md bg-accent-sheen px-4 py-2 text-[12px] font-medium text-bg shadow-glow transition hover:shadow-glow-2 md:min-h-0"
                      >
                        <Check size={12} strokeWidth={2.6} />
                        Approve &amp; run in Salesforce
                        <span className="sheen-overlay" aria-hidden />
                      </button>
                    )}
                    {st.kind === "executing" && (
                      <span className="flex items-center gap-2 text-[12px] text-text-muted">
                        <Loader2 size={12} className="animate-spin text-accent" />
                        Writing through CRM…
                      </span>
                    )}
                    {st.kind === "done" && (
                      <span className="flex items-center gap-2 text-[12px] text-emerald-300">
                        <Check size={12} />
                        Executed
                      </span>
                    )}
                    {st.kind === "error" && (
                      <span className="flex items-center gap-2 text-[12px] text-red-300">
                        <X size={12} />
                        {st.message}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {sources.map((s) => (
            <span
              key={s}
              className="rounded-full border border-border-soft px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted"
            >
              {s}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
