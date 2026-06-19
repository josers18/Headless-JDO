"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AskDataTraceStep } from "@/lib/client/useAskDataStream";
import type { IterationUsage } from "@/components/horizon/ReasoningTrail";

/**
 * Ask My Data / Analyze reasoning trail. Visually mirrors Today's
 * ReasoningTrail (collapsible, status-coded rows) but scoped to the
 * second inference stack. When per-iteration usage is supplied, rows are
 * grouped under "turn N · X in / Y out" headers and each row shows the
 * approximate token size of its result.
 */
export function AskDataTrace({
  steps,
  iterationUsage = [],
  defaultOpen = false,
}: {
  steps: AskDataTraceStep[];
  iterationUsage?: IterationUsage[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const usageByIteration = useMemo(() => {
    const m = new Map<number, IterationUsage>();
    for (const u of iterationUsage) m.set(u.iteration, u);
    return m;
  }, [iterationUsage]);
  const showGroups = iterationUsage.length > 0;

  const totalTokens = useMemo(() => {
    let inTok = 0;
    let outTok = 0;
    let exact = true;
    for (const u of iterationUsage) {
      inTok += u.inputTokens;
      outTok += u.outputTokens;
      exact = exact && u.exact;
    }
    return { inTok, outTok, total: inTok + outTok, exact };
  }, [iterationUsage]);

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
        {showGroups && totalTokens.total > 0 && (
          <span
            className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] normal-case tracking-normal text-text-muted/80"
            title={`${totalTokens.inTok.toLocaleString()} in / ${totalTokens.outTok.toLocaleString()} out${totalTokens.exact ? "" : " (includes estimates)"}`}
          >
            {totalTokens.exact ? "" : "≈"}
            {fmtTok(totalTokens.total)} tok
          </span>
        )}
      </button>
      {open && (
        <div className="space-y-2 border-t border-border-soft/40 px-3 py-2">
          {steps.map((s, i) => {
            const prev = i > 0 ? steps[i - 1] : undefined;
            const header =
              showGroups &&
              s.iteration !== undefined &&
              s.iteration !== prev?.iteration
                ? usageByIteration.get(s.iteration)
                : undefined;
            return (
              <div key={s.callId} className="space-y-1.5">
                {header && (
                  <div className="flex items-center gap-2 pt-1 first:pt-0">
                    <span className="text-[9px] uppercase tracking-[0.18em] text-text-muted/60">
                      turn {header.iteration}
                    </span>
                    <span className="h-px flex-1 bg-border-soft/40" />
                    <span className="font-mono text-[9px] tabular-nums text-text-muted/70">
                      {header.exact ? "" : "≈"}
                      {fmtTok(header.inputTokens)} in /{" "}
                      {fmtTok(header.outputTokens)} out
                    </span>
                  </div>
                )}
                <div className="flex flex-col gap-1 text-[12px]">
                  <div className="flex items-center gap-2">
                    <StatusDot status={s.status} />
                    <code className="rounded bg-surface2 px-1.5 py-0.5 text-[11px] text-text">
                      {s.name}
                    </code>
                    <span className="truncate text-text-muted">
                      {summarizeInput(s.input)}
                    </span>
                    {typeof s.resultTokens === "number" &&
                      s.resultTokens > 0 && (
                        <span
                          className="ml-auto shrink-0 rounded border border-border-soft/60 px-1.5 py-[1px] text-[9px] tabular-nums text-text-muted/70"
                          title="Approx. token size of this result pulled into context (estimate)"
                        >
                          ~{fmtTok(s.resultTokens)} tok
                        </span>
                      )}
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
                </div>
              </div>
            );
          })}
        </div>
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

/** Humanize a token count: 940 → "940", 6100 → "6.1k", 1.2M → "1.2M". */
function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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
