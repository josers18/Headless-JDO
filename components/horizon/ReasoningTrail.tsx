"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Check, X, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Step {
  server: string;
  tool: string;
  input?: unknown;
  status?: "running" | "ok" | "error";
  preview?: string;
}

// The reasoning trail is where the curious banker can see what Horizon
// actually did. For the demo this is a visual differentiator — every
// other "AI dashboard" hides its work. We treat it as first-class: a
// collapsed summary badge by default, with a neatly pretty-printed
// tool-call log on expand.
export function ReasoningTrail({
  steps,
  defaultOpen = false,
}: {
  steps: Step[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const counts = useMemo(() => {
    let running = 0;
    let errors = 0;
    let ok = 0;
    for (const s of steps) {
      if (s.status === "running") running++;
      else if (s.status === "error") errors++;
      else if (s.status === "ok") ok++;
    }
    return { running, errors, ok };
  }, [steps]);

  if (steps.length === 0) return null;

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-soft bg-surface/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-[11px] uppercase tracking-[0.18em] text-text-muted transition hover:text-text"
      >
        <ChevronRight
          size={12}
          className={cn(
            "transition-transform duration-med ease-out",
            open && "rotate-90"
          )}
        />
        <Activity size={12} className="text-accent/80" />
        <span className="tracking-[0.22em]">Reasoning trail</span>
        <span className="ml-2 font-mono text-[10px] normal-case tracking-normal text-text-muted/80">
          {steps.length} {steps.length === 1 ? "call" : "calls"}
        </span>
        <span className="ml-3 flex items-center gap-2 normal-case tracking-normal">
          {counts.ok > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-300/90">
              <Check size={11} strokeWidth={2.4} />
              {counts.ok}
            </span>
          )}
          {counts.running > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-accent">
              <Loader2 size={11} className="animate-spin" />
              {counts.running}
            </span>
          )}
          {counts.errors > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-red-300/90">
              <X size={11} strokeWidth={2.4} />
              {counts.errors}
            </span>
          )}
        </span>
      </button>

      {open && (
        <ul className="animate-fade-in space-y-1.5 border-t border-border-soft bg-black/20 p-3">
          {steps.map((s, i) => (
            <TrailRow key={i} step={s} />
          ))}
        </ul>
      )}
    </div>
  );
}

// One row per tool call. We show the server + tool + compact input on the
// header line, and a pretty-printed preview block on expand. Errors get a
// colored left rail + danger color on the preview so they're instantly
// legible.
function TrailRow({ step }: { step: Step }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(step.preview);
  const formatted = useMemo(
    () => (step.preview ? prettyPreview(step.preview) : ""),
    [step.preview]
  );

  return (
    <li
      className={cn(
        "group relative rounded-md border border-transparent bg-surface/60 px-3 py-2 transition-colors",
        step.status === "error" && "bg-danger/5"
      )}
    >
      <button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        disabled={!canExpand}
        className="flex w-full items-center gap-2 text-left font-mono text-[11.5px]"
      >
        <StatusDot status={step.status} />
        <span className="text-accent">{step.server}</span>
        <span className="text-text-muted/70">.{step.tool}</span>
        <span className="ml-auto truncate text-[10px] text-text-muted/60">
          {step.input ? truncJson(step.input) : ""}
        </span>
        {canExpand && (
          <ChevronRight
            size={11}
            className={cn(
              "ml-2 shrink-0 text-text-muted/50 transition-transform duration-fast",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>
      {canExpand && expanded && (
        <pre
          className={cn(
            "mt-2 max-h-[240px] overflow-auto rounded-md border border-border-soft bg-black/40 px-3 py-2 font-mono text-[11px] leading-snug text-text-muted/90",
            step.status === "error" && "border-danger/30 text-red-300/90"
          )}
        >
          {formatted}
        </pre>
      )}
    </li>
  );
}

function StatusDot({ status }: { status?: Step["status"] }) {
  if (status === "running")
    return <Loader2 size={11} className="shrink-0 animate-spin text-accent" />;
  if (status === "error")
    return <X size={11} strokeWidth={2.6} className="shrink-0 text-red-400" />;
  if (status === "ok")
    return <Check size={11} strokeWidth={2.6} className="shrink-0 text-emerald-400" />;
  return (
    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-text-muted/40" />
  );
}

function truncJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 110 ? s.slice(0, 107) + "…" : s;
  } catch {
    return String(v);
  }
}

// Best-effort pretty-print: if the preview is valid JSON (either the whole
// string or inside a code fence), indent it to 2 spaces. Otherwise return
// the raw text trimmed to a humane length. Keeps the demo looking clean
// when MCP tools return structured payloads while not blowing up when they
// return plain text.
function prettyPreview(raw: string): string {
  const s = raw.trim();
  if (!s) return raw;
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced?.[1] ?? s).trim();
  if (
    (candidate.startsWith("{") && candidate.endsWith("}")) ||
    (candidate.startsWith("[") && candidate.endsWith("]"))
  ) {
    try {
      const parsed = JSON.parse(candidate);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // fall through — preview wasn't quite JSON
    }
  }
  if (s.length > 1200) return s.slice(0, 1197) + "…";
  return s;
}
