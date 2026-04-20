"use client";

import { cn } from "@/lib/utils";
import {
  dispatchHorizonAskSubmit,
  type HorizonAskSubmitDetail,
} from "@/lib/client/horizonEvents";

export function GhostPrompt({
  text,
  className,
  context,
}: {
  text: string;
  className?: string;
  /** Optional extra scroll/focus line merged into the ask payload. */
  context?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const detail: HorizonAskSubmitDetail = { q: text };
        if (context && context.trim()) detail.context = context.trim();
        dispatchHorizonAskSubmit(detail);
      }}
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-full border border-border-soft/80 bg-surface2/40 px-3 py-1.5 text-left text-[12px] leading-snug text-text-muted transition hover:border-accent/40 hover:text-text",
        className
      )}
    >
      <span className="truncate">{text}</span>
    </button>
  );
}
