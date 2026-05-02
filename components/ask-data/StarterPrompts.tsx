"use client";

import { STARTER_PROMPTS } from "@/lib/ask/starterPrompts";

export type StarterPromptsProps = {
  /** Called when the banker clicks a pill. T1-1 wiring populates the input. */
  onPick: (prompt: string) => void;
};

export function StarterPrompts({ onPick }: StarterPromptsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {STARTER_PROMPTS.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="rounded-full border border-border-soft bg-surface/60 px-3.5 py-2 text-left text-[13px] text-text-muted transition duration-fast hover:border-accent/50 hover:bg-surface-raised hover:text-text focus:outline-none focus-visible:border-accent focus-visible:text-text"
        >
          {p}
        </button>
      ))}
    </div>
  );
}
