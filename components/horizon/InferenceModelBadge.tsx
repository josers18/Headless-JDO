"use client";

import { Cpu } from "lucide-react";
import type { InferenceMeta } from "@/lib/client/useAgentStream";
import { cn } from "@/lib/utils";

export function InferenceModelBadge({
  meta,
  className,
}: {
  meta: InferenceMeta | null;
  className?: string;
}) {
  if (!meta) return null;
  const label = meta.backend === "onyx" ? "Kimi" : "Claude";
  return (
    <span
      title={`${label} (secondary inference) · ${meta.model}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-border-soft/70 bg-surface2/50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-text-muted/90 tabular-nums",
        className
      )}
    >
      <Cpu size={10} className="shrink-0 opacity-70" aria-hidden />
      <span>{label}</span>
    </span>
  );
}
