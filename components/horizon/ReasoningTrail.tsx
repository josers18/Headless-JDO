"use client";

import { useState } from "react";
import { ChevronRight, Loader2, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  server: string;
  tool: string;
  input?: unknown;
  status?: "running" | "ok" | "error";
  preview?: string;
}

export function ReasoningTrail({
  steps,
  defaultOpen = true,
}: {
  steps: Step[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;
  const running = steps.filter((s) => s.status === "running").length;
  const errors = steps.filter((s) => s.status === "error").length;

  return (
    <div className="rounded-lg border border-border/60 bg-surface2/40 p-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-muted hover:text-text"
      >
        <ChevronRight
          size={12}
          className={cn(
            "transition-transform duration-fast ease-out",
            open && "rotate-90"
          )}
        />
        Reasoning trail · {steps.length}{" "}
        {steps.length === 1 ? "call" : "calls"}
        {running > 0 && (
          <span className="ml-2 text-accent">· {running} running</span>
        )}
        {errors > 0 && (
          <span className="ml-2 text-red-400">· {errors} failed</span>
        )}
      </button>
      {open && (
        <ul className="mt-3 space-y-2 font-mono text-[12px] text-text-muted">
          {steps.map((s, i) => (
            <li
              key={i}
              className="animate-fade-rise rounded-md bg-surface/60 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <StatusDot status={s.status} />
                <span className="text-accent">{s.server}</span>
                <span className="text-text-muted">.{s.tool}</span>
                <span className="text-text-muted/60">
                  ({s.input ? truncJson(s.input) : ""})
                </span>
              </div>
              {s.preview && s.status !== "running" && (
                <div
                  className={cn(
                    "mt-1.5 whitespace-pre-wrap break-words pl-5 text-[11px] leading-snug",
                    s.status === "error"
                      ? "text-red-300/80"
                      : "text-text-muted/70"
                  )}
                >
                  {s.preview.length > 280
                    ? s.preview.slice(0, 277) + "…"
                    : s.preview}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ status }: { status?: Step["status"] }) {
  if (status === "running")
    return <Loader2 size={11} className="animate-spin text-accent" />;
  if (status === "error") return <X size={11} className="text-red-400" />;
  if (status === "ok") return <Check size={11} className="text-emerald-400" />;
  return <span className="h-[6px] w-[6px] rounded-full bg-text-muted/40" />;
}

function truncJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 140 ? s.slice(0, 137) + "…" : s;
  } catch {
    return String(v);
  }
}
