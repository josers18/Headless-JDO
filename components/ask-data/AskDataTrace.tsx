"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskDataTraceStep } from "@/lib/client/useAskDataStream";

/**
 * Ask My Data reasoning trail. Visually mirrors Today's ReasoningTrail
 * (collapsible, status-coded rows) but scoped to the single MCP in
 * Ask My Data. Rows render as "tool_name(input_summary) → preview".
 */
export function AskDataTrace({
  steps,
  defaultOpen = false,
}: {
  steps: AskDataTraceStep[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;

  const running = steps.filter((s) => s.status === "running").length;
  const ok = steps.filter((s) => s.status === "done").length;
  const errored = steps.filter((s) => s.status === "error").length;

  return (
    <div className="rounded-lg border border-border-soft/60 bg-surface/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] uppercase tracking-[0.18em] text-text-muted transition hover:text-text"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Reasoning trail · {steps.length}{" "}
          {steps.length === 1 ? "step" : "steps"}
          {ok > 0 && <span className="text-success">· {ok} ok</span>}
          {errored > 0 && <span className="text-danger">· {errored} err</span>}
          {running > 0 && (
            <span className="text-accent">· {running} running</span>
          )}
        </span>
      </button>
      {open && (
        <ul className="space-y-1 border-t border-border-soft/40 px-3 py-2">
          {steps.map((s) => (
            <li key={s.callId} className="flex flex-col gap-1 text-[12px]">
              <div className="flex items-center gap-2">
                <StatusDot status={s.status} />
                <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-text">
                  {s.name}
                </code>
                <span className="truncate text-text-muted">
                  {summarizeInput(s.input)}
                </span>
              </div>
              {s.preview && (
                <div
                  className={cn(
                    "ml-5 truncate text-[11px]",
                    s.status === "error"
                      ? "text-danger/80"
                      : "text-text-muted/80"
                  )}
                >
                  {s.preview}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: AskDataTraceStep["status"] }) {
  if (status === "running") {
    return <Loader2 size={12} className="animate-spin text-accent" />;
  }
  if (status === "error") {
    return (
      <span
        className="inline-block h-[6px] w-[6px] rounded-full bg-danger"
        aria-hidden
      />
    );
  }
  return (
    <span
      className="inline-block h-[6px] w-[6px] rounded-full bg-success"
      aria-hidden
    />
  );
}

function summarizeInput(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return "()";
  // Short preview — "query: SELECT ssot__Id__c FROM …"
  const [k, v] = entries[0]!;
  const valStr =
    typeof v === "string"
      ? v.replace(/\s+/g, " ")
      : JSON.stringify(v);
  const snippet = valStr.length > 100 ? valStr.slice(0, 97) + "…" : valStr;
  const more = entries.length > 1 ? ` (+${entries.length - 1})` : "";
  return `${k}: ${snippet}${more}`;
}
