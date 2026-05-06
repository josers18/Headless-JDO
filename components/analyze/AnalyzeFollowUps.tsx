"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; suggestions: string[] }
  | { kind: "error" };

export type FollowUpPriorTurn = {
  userQuestion: string;
  assistantText: string;
};

/**
 * Context-aware follow-up pills. Replaces the "Try asking" starter row
 * after the first completed turn so the banker always sees their most
 * relevant next-step suggestions above the Ask bar (Q-T2-6-a = C).
 *
 * Click pre-fills the Ask bar via onPick (Q-T2-6-b = B) — banker can
 * edit before submitting. Matches the "take the suggestion, refine it"
 * analytical-workbench pattern better than fire-on-click.
 *
 * `priorTurns` carries earlier (user, assistant) pairs this session so
 * MiniMax generates suggestions aware of the running thread, not just
 * the latest answer. Server caps to 3 most recent.
 */
export function AnalyzeFollowUps({
  question,
  assistantText,
  priorTurns,
  onPick,
  disabled = false,
}: {
  question: string;
  assistantText: string;
  priorTurns?: FollowUpPriorTurn[];
  onPick: (suggestion: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  // Fetch effect — abortable. StrictMode double-invokes effects in dev,
  // which used to fire two back-to-back requests; the second one
  // resolving after the first would flash the pills and then overwrite
  // with a stale "error" or empty result, producing the "pop then
  // disappear" behavior. Using AbortController + a mounted flag keeps
  // only the most recent request's resolution authoritative.
  useEffect(() => {
    // Guard: need meaningful content on both sides. Short stubs would
    // produce generic or nonsensical suggestions.
    if (!question || !assistantText || assistantText.trim().length < 40) {
      if (process.env.NODE_ENV !== "production") {
        // eslint-disable-next-line no-console
        console.warn("[followups] guard skipped fetch", {
          qLen: question?.length ?? 0,
          aLen: assistantText?.trim().length ?? 0,
        });
      }
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setState({ kind: "loading" });

    (async () => {
      try {
        const res = await fetch("/api/analyze-followups", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            assistantText,
            priorTurns: priorTurns ?? [],
          }),
          signal: controller.signal,
        });
        if (cancelled) return;
        if (!res.ok) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[followups] fetch not ok", { status: res.status });
          }
          setState({ kind: "error" });
          return;
        }
        const data = (await res.json()) as { suggestions: string[] };
        if (cancelled) return;
        if (!data.suggestions || data.suggestions.length === 0) {
          if (process.env.NODE_ENV !== "production") {
            // eslint-disable-next-line no-console
            console.warn("[followups] empty suggestions", { data });
          }
          setState({ kind: "error" });
          return;
        }
        setState({ kind: "ready", suggestions: data.suggestions });
      } catch (err) {
        if (cancelled) return;
        // AbortError is expected when StrictMode unmounts the first
        // effect — don't treat it as a failure state.
        if ((err as { name?: string } | null)?.name === "AbortError") return;
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.warn("[followups] fetch threw", { err });
        }
        setState({ kind: "error" });
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
    // priorTurns: dep on length + last question (a cheap fingerprint)
    // rather than identity. The workbench builds a fresh array every
    // render, so identity alone would refire the effect endlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    question,
    assistantText,
    priorTurns?.length,
    priorTurns?.at(-1)?.userQuestion,
  ]);

  // Render nothing while loading or on failure — the Ask bar below is
  // still fully functional; we don't want a spinner flashing in an
  // otherwise-silent slot. On failure, keep quiet.
  if (state.kind !== "ready") return null;

  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        <Sparkles size={11} />
        Follow-up suggestions
      </div>
      <div className="flex flex-wrap gap-2">
        {state.suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => !disabled && onPick(s)}
            disabled={disabled}
            className="rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-left text-[13px] text-text-muted transition duration-fast hover:border-accent/50 hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:border-accent focus-visible:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </section>
  );
}
