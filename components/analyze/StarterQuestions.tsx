"use client";

import { getStarterQuestions } from "@/lib/analyze/modelStarterQuestions";

/**
 * Per-model preset question pills. Shown below the named-metric pills
 * on /analyze/[modelId] before the banker has submitted anything.
 *
 * Clicking a pill passes the question to onPick — the page wires that
 * to AnalyzeWorkbench which fires the agent turn immediately (matches
 * Ask My Data's starter-click-submits pattern).
 */
export function StarterQuestions({
  apiName,
  onPick,
  disabled = false,
}: {
  apiName: string;
  onPick: (question: string) => void;
  disabled?: boolean;
}) {
  const questions = getStarterQuestions(apiName);
  if (questions.length === 0) return null;

  return (
    <section className="mt-6">
      <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        Try asking
      </div>
      <div className="flex flex-wrap gap-2">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => !disabled && onPick(q)}
            disabled={disabled}
            className="rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-left text-[13px] text-text-muted transition duration-fast hover:border-accent/50 hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:border-accent focus-visible:text-text disabled:cursor-not-allowed disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>
    </section>
  );
}
