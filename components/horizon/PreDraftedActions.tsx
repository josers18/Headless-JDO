"use client";

import { cn } from "@/lib/utils";
import { ReasoningTrail } from "./ReasoningTrail";
import { DraftActionCard } from "./DraftActionCard";
import { useDrafts } from "./DraftsContext";

// Pre-drafted actions: drafts whose targets are not shown inline on the
// priority queue surface here; matched drafts render under their client row.

export function PreDraftedActions() {
  const {
    orphanDrafts,
    drafts,
    steps,
    state,
    error,
    draftsKickoffPending,
    statuses,
    approve,
    dismiss,
  } = useDrafts();

  const isLoading =
    (state === "streaming" || (state === "idle" && draftsKickoffPending)) &&
    drafts.length === 0;

  return (
    <div data-horizon-section="drafts">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent/80",
              (state === "streaming" || draftsKickoffPending) &&
                "animate-glow-pulse"
            )}
          />
          Pre-drafted actions
        </h2>
        {state === "streaming" && (
          <span className="font-mono text-[10px] text-text-muted/70">
            drafting…
          </span>
        )}
      </div>

      {isLoading && (
        <div className="mt-6 space-y-3">
          <div className="h-[140px] rounded-xl shimmer" aria-hidden />
          <div className="h-[140px] rounded-xl shimmer" aria-hidden />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
          {error}
        </div>
      )}

      {!isLoading &&
        orphanDrafts.length === 0 &&
        state !== "streaming" &&
        !error &&
        drafts.length > 0 && (
          <p className="mt-6 max-w-prose text-[14px] leading-relaxed text-text-muted">
            Drafts for priority clients appear inline on the queue above.
          </p>
        )}

      {!isLoading &&
        drafts.length === 0 &&
        state !== "streaming" &&
        !error && (
          <p className="mt-6 max-w-prose text-[14px] leading-relaxed text-text-muted">
            No drafts ready. Try again after the morning brief has run.
          </p>
        )}

      {orphanDrafts.length > 0 && (
        <ul className="mt-6 space-y-3">
          {orphanDrafts.map((d, idx) => {
            const st = statuses[d.id] ?? { kind: "idle" as const };
            if (st.kind === "dismissed") return null;
            return (
              <DraftActionCard
                key={d.id}
                draft={d}
                index={idx}
                status={st}
                onApprove={() => void approve(d)}
                onDismiss={() => dismiss(d)}
              />
            );
          })}
        </ul>
      )}

      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}
