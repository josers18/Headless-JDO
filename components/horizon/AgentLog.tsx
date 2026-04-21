"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  Check,
  AlertTriangle,
  Loader2,
  Undo2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentLog } from "@/lib/client/actions/useAction";
import type { AgentLogEntry, HorizonAction } from "@/lib/client/actions/registry";

/**
 * C-3 — AgentLog panel. Sits at the foot of the home page (collapsed by
 * default) and shows the audit trail of everything Horizon did in this
 * session: snoozes, drafts queued, auto-executions, investigations. Each
 * entry surfaces its outcome and, if an undo token was registered, an
 * Undo button.
 *
 * We keep this intentionally lo-fi — the banker's trust-level here scales
 * with legibility, not flash.
 */
export function AgentLog() {
  const entries = useAgentLog();
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  const recent = open ? entries : entries.slice(0, 3);

  return (
    <section
      aria-labelledby="agent-log-h"
      className="mt-10 rounded-xl border border-border-soft/40 bg-surface/15 px-4 py-3"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span
          id="agent-log-h"
          className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-text-muted"
        >
          <Activity size={12} className="opacity-70" />
          Agent log
          <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] text-text-muted/80">
            {entries.length}
          </span>
        </span>
        {open ? (
          <ChevronUp size={12} className="text-text-muted" />
        ) : (
          <ChevronDown size={12} className="text-text-muted" />
        )}
      </button>
      <ul className="mt-2 divide-y divide-border-soft/30">
        {recent.map((e) => (
          <AgentLogRow key={e.id} entry={e} />
        ))}
      </ul>
    </section>
  );
}

function AgentLogRow({ entry }: { entry: AgentLogEntry }) {
  const label = useMemo(() => describeAction(entry.action), [entry.action]);
  const when = useMemo(
    () =>
      new Date(entry.timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      }),
    [entry.timestamp]
  );

  return (
    <li className="flex items-start gap-3 py-2 text-[12px]">
      <OutcomeDot outcome={entry.outcome} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-text">{label}</div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
          {entry.action.kind.replace(/_/g, " ")} · {when}
        </div>
        {entry.message && entry.outcome === "error" && (
          <div className="mt-0.5 text-[11px] text-rose-300/90">
            {entry.message}
          </div>
        )}
      </div>
      {entry.undo && entry.outcome === "success" && (
        <button
          type="button"
          onClick={() => void entry.undo?.()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border-soft px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-muted transition hover:border-accent/40 hover:text-text"
        >
          <Undo2 size={11} />
          Undo
        </button>
      )}
    </li>
  );
}

function OutcomeDot({ outcome }: { outcome: AgentLogEntry["outcome"] }) {
  const cls = cn(
    "mt-[2px] shrink-0",
    outcome === "success" && "text-emerald-300",
    outcome === "error" && "text-rose-300",
    outcome === "queued" && "text-accent animate-pulse",
    outcome === "skipped" && "text-text-muted/60"
  );
  if (outcome === "queued")
    return <Loader2 size={12} className={cls} aria-hidden />;
  if (outcome === "success")
    return <Check size={12} className={cls} aria-hidden />;
  if (outcome === "error")
    return <AlertTriangle size={12} className={cls} aria-hidden />;
  return <span className={cn("mt-[6px] h-1.5 w-1.5 rounded-full", cls)} aria-hidden />;
}

function describeAction(a: HorizonAction): string {
  switch (a.kind) {
    case "ask":
      return `Asked: "${trunc(a.question, 80)}"`;
    case "investigate":
      return `Investigated: "${trunc(a.question, 80)}"`;
    case "open_client":
      return `Opened ${a.clientName ?? "client"} detail`;
    case "lightning":
      return `Opened Lightning record ${a.recordId}`;
    case "prep":
      return `Prep brief for ${a.clientName ?? "client"}`;
    case "draft_email":
      return `Drafted email to ${a.clientName ?? "client"}: ${trunc(a.reason, 60)}`;
    case "draft_call":
      return `Drafted call script for ${a.clientName ?? "client"}`;
    case "create_task":
      return `Created task: "${trunc(a.subject, 60)}"`;
    case "snooze":
      return `Snoozed ${a.itemKey} for ${a.minutes}m`;
    case "dismiss":
      return `Dismissed ${a.itemKey}`;
    case "refresh":
      return `Refreshed ${a.surface}`;
    case "do_for_me":
      return `Auto-executed ${a.plan.kind}: ${trunc(a.reason, 60)}`;
    case "execute":
      return `Executed draft ${a.draftId}`;
    default: {
      const exhaustive: never = a;
      void exhaustive;
      return "Action";
    }
  }
}

function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
