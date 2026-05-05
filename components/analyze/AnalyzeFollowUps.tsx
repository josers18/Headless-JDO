"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

type FetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; suggestions: string[] }
  | { kind: "error" };

/**
 * Context-aware follow-up pills. Replaces the "Try asking" starter row
 * after the first completed turn so the banker always sees their most
 * relevant next-step suggestions above the Ask bar (Q-T2-6-a = C).
 *
 * Click pre-fills the Ask bar via onPick (Q-T2-6-b = B) — banker can
 * edit before submitting. Matches the "take the suggestion, refine it"
 * analytical-workbench pattern better than fire-on-click.
 */
export function AnalyzeFollowUps({
  question,
  assistantText,
  onPick,
  disabled = false,
}: {
  question: string;
  assistantText: string;
  onPick: (suggestion: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<FetchState>({ kind: "idle" });

  const load = useCallback(async () => {
    // Require meaningful content on both sides before asking MiniMax
    // for follow-ups — short stubs produce generic or nonsensical
    // suggestions.
    if (!question || !assistantText || assistantText.trim().length < 40) return;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/analyze-followups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, assistantText }),
      });
      if (!res.ok) {
        setState({ kind: "error" });
        return;
      }
      const data = (await res.json()) as { suggestions: string[] };
      if (!data.suggestions || data.suggestions.length === 0) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", suggestions: data.suggestions });
    } catch {
      setState({ kind: "error" });
    }
  }, [question, assistantText]);

  // Only fetch once per (question, assistantText) pair — the hook deps
  // memoize load, and state reset means each pair fetches fresh.
  useEffect(() => {
    void load();
  }, [load]);

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
