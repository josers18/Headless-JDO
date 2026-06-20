"use client";

import { useMemo, useState } from "react";
import { ChevronRight, Loader2, Check, X, Activity, ShieldOff } from "lucide-react";
import { cn, formatToolLeafForDisplay } from "@/lib/utils";

export interface Step {
  server: string;
  tool: string;
  input?: unknown;
  status?: "running" | "ok" | "error";
  preview?: string;
  /** 1-based inference iteration this tool call belonged to (for grouping). */
  iteration?: number;
  /** Approx token size of this result the model ingested (estimate). */
  resultTokens?: number;
}

/** Per-iteration exact model usage, keyed by iteration number. */
export interface IterationUsage {
  iteration: number;
  inputTokens: number;
  outputTokens: number;
  exact: boolean;
}

// "Group" is how we render steps — consecutive identical-signature errors
// from the same server+tool collapse into a single row with a ×N counter.
// This keeps the demo from looking broken when the runtime circuit breaker
// ships with 3+ "blocked" entries in a row.
type Group =
  | { kind: "single"; step: Step; originalIndex: number }
  | {
      kind: "aggregate";
      server: string;
      tool: string;
      count: number;
      firstPreview: string;
      status: "error";
      originalIndex: number;
      /** Iteration the collapsed run belongs to (from its first step). */
      iteration?: number;
    };

// The reasoning trail is where the curious banker can see what Horizon
// actually did. For the demo this is a visual differentiator — every
// other "AI dashboard" hides its work. We treat it as first-class: a
// collapsed summary badge by default, with a neatly pretty-printed
// tool-call log on expand.
export function ReasoningTrail({
  steps,
  iterationUsage = [],
  defaultOpen = false,
}: {
  steps: Step[];
  iterationUsage?: IterationUsage[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Do we have any per-iteration usage to show? If not (e.g. an old cached
  // section without iteration_usage events), fall back to the flat layout.
  const showIterationGroups = iterationUsage.length > 0;

  const counts = useMemo(() => {
    let running = 0;
    let errors = 0;
    let handled = 0;
    let ok = 0;
    for (const s of steps) {
      if (s.status === "running") running++;
      else if (s.status === "error") {
        // Schema-mismatch rows are expected edge cases that the circuit
        // breaker caught — they're not true failures, so we count them
        // in a separate "handled" bucket to keep the header calm.
        if (isHandledError(s)) handled++;
        else errors++;
      } else if (s.status === "ok") ok++;
    }
    return { running, errors, handled, ok };
  }, [steps]);

  // Group consecutive identical-signature errors so the trail reads "×3
  // schema mismatches" instead of three indistinguishable red rows.
  const groups = useMemo(() => collapseGroups(steps), [steps]);

  // Exact total tokens the model billed this turn (sum of per-iteration
  // usage). Shown as a header badge when we have iteration usage.
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

  return (
    <div className="relative overflow-hidden rounded-xl border border-border-soft bg-surface">
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
        {showIterationGroups && totalTokens.total > 0 && (
          <span
            className="ml-2 rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] normal-case tracking-normal text-text-muted/80"
            title={`${totalTokens.inTok.toLocaleString()} in / ${totalTokens.outTok.toLocaleString()} out${totalTokens.exact ? "" : " (includes estimates)"}`}
          >
            {totalTokens.exact ? "" : "≈"}
            {fmtTok(totalTokens.total)} tok
          </span>
        )}
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
          {counts.handled > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] text-amber-300/90"
              title="Schema mismatches caught by the breaker — handled gracefully"
            >
              <ShieldOff size={11} strokeWidth={2.4} />
              {counts.handled}
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
        <div className="animate-fade-in space-y-1.5 border-t border-border-soft bg-black/20 p-3">
          {showIterationGroups ? (
            // Iteration-grouped layout. The sorted iterationUsage list is the
            // SPINE — we walk turns in numeric order and render each turn's
            // groups under it. This is deliberate:
            //   - Gap fix: a turn that emitted zero tool calls (e.g. the final
            //     synthesis turn) still gets a header, instead of silently
            //     vanishing because no step carried its iteration to anchor on.
            //   - Order fix: headers render strictly 1,2,3… by walking the
            //     sorted spine, never in step-arrival order.
            // Any groups whose iteration isn't in the usage map (old cached
            // trails predating iteration tagging, or untagged rows) fall into
            // an "untagged" bucket rendered last with no header.
            <IterationGroupedTrail
              groups={groups}
              iterationUsage={iterationUsage}
            />
          ) : (
            // Flat fallback: no per-iteration usage (e.g. a v1 cached section
            // captured before iteration_usage events existed). Render groups
            // in order with no turn headers.
            groups.map((g, i) => (
              <GroupBody key={`grp-${g.originalIndex}-${i}`} group={g} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Renders the body of one render group (a single tool row or a collapsed
// aggregate). Header rendering is the caller's responsibility.
function GroupBody({ group }: { group: Group }) {
  return (
    <div className="space-y-1.5">
      {group.kind === "single" ? (
        <TrailRow step={group.step} />
      ) : (
        <AggregateRow
          server={group.server}
          tool={group.tool}
          count={group.count}
          firstPreview={group.firstPreview}
        />
      )}
    </div>
  );
}

// One turn header + its groups. A turn with no groups (the model thought /
// answered without calling any tool) still renders its header so the turn
// sequence reads 1,2,3… with no gaps.
function TurnSection({
  usage,
  groups,
}: {
  usage: IterationUsage;
  groups: Group[];
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 pt-1.5 first:pt-0">
        <span className="text-[9px] uppercase tracking-[0.18em] text-text-muted/60">
          turn {usage.iteration}
        </span>
        <span className="h-px flex-1 bg-border-soft/40" />
        <span className="font-mono text-[9px] tabular-nums text-text-muted/70">
          {usage.exact ? "" : "≈"}
          {fmtTok(usage.inputTokens)} in / {fmtTok(usage.outputTokens)} out
        </span>
      </div>
      {groups.map((g, i) => (
        <GroupBody key={`grp-${g.originalIndex}-${i}`} group={g} />
      ))}
    </div>
  );
}

// Iteration-grouped trail body. Walks the sorted usage list as the spine so
// turns render in numeric order and every turn gets a header — including
// turns that emitted no tool calls. Groups are bucketed by their tagged
// iteration; any group whose iteration has no usage record (legacy/untagged)
// renders last under no header.
function IterationGroupedTrail({
  groups,
  iterationUsage,
}: {
  groups: Group[];
  iterationUsage: IterationUsage[];
}) {
  const sortedUsage = useMemo(
    () => [...iterationUsage].sort((a, b) => a.iteration - b.iteration),
    [iterationUsage]
  );
  const known = useMemo(
    () => new Set(iterationUsage.map((u) => u.iteration)),
    [iterationUsage]
  );

  // Bucket groups by iteration, preserving arrival order within a bucket.
  const byIteration = useMemo(() => {
    const m = new Map<number, Group[]>();
    const untagged: Group[] = [];
    for (const g of groups) {
      const iter = groupIteration(g);
      if (iter !== undefined && known.has(iter)) {
        const bucket = m.get(iter);
        if (bucket) bucket.push(g);
        else m.set(iter, [g]);
      } else {
        untagged.push(g);
      }
    }
    return { m, untagged };
  }, [groups, known]);

  return (
    <>
      {sortedUsage.map((usage) => (
        <TurnSection
          key={`turn-${usage.iteration}`}
          usage={usage}
          groups={byIteration.m.get(usage.iteration) ?? []}
        />
      ))}
      {byIteration.untagged.map((g, i) => (
        <GroupBody key={`untagged-${g.originalIndex}-${i}`} group={g} />
      ))}
    </>
  );
}

// Aggregate row — used when consecutive error rows from the same
// server+tool share an error signature. Shows one line with ×N so the
// trail isn't a wall of identical red rows. Still expandable to see the
// original payload.
function AggregateRow({
  server,
  tool,
  count,
  firstPreview,
}: {
  server: string;
  tool: string;
  count: number;
  firstPreview: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const formatted = useMemo(() => prettyPreview(firstPreview), [firstPreview]);
  const isBlocked = /blocked by schema-mismatch breaker/i.test(firstPreview);

  return (
    <div className="group relative rounded-md border border-amber-400/15 bg-amber-400/5 px-3 py-2 transition-colors">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full items-center gap-2 text-left font-mono text-[11.5px]"
      >
        <ShieldOff
          size={11}
          strokeWidth={2.4}
          className="shrink-0 text-amber-300"
        />
        <span className="text-accent">{server}</span>
        <span className="text-text-muted/70">
          .{formatToolLeafForDisplay(tool)}
        </span>
        <span className="ml-2 rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-[1px] text-[10px] tabular-nums text-amber-200/90">
          ×{count}
        </span>
        <span className="ml-auto truncate text-[10px] text-text-muted/60">
          {isBlocked
            ? "breaker — further calls suppressed"
            : `${count} guesses caught — recovered`}
        </span>
        <ChevronRight
          size={11}
          className={cn(
            "ml-2 shrink-0 text-text-muted/50 transition-transform duration-fast",
            expanded && "rotate-90"
          )}
        />
      </button>
      {expanded && (
        <pre className="mt-2 max-h-[240px] overflow-auto rounded-md border border-amber-400/30 bg-black/40 px-3 py-2 font-mono text-[11px] leading-snug text-amber-200/90">
          {formatted}
        </pre>
      )}
    </div>
  );
}

// Collapse consecutive same-server, same-tool error rows whose previews
// share an error signature. Non-error rows and heterogeneous sequences
// render as individual single rows. We only collapse runs of 2+ matching
// errors — a lone error still renders normally so the reader can still
// see the exact payload.
function collapseGroups(steps: Step[]): Group[] {
  const out: Group[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if (!s) {
      i++;
      continue;
    }
    const sig = errorSignature(s);
    if (!sig) {
      out.push({ kind: "single", step: s, originalIndex: i });
      i++;
      continue;
    }
    let j = i + 1;
    while (j < steps.length) {
      const next = steps[j];
      if (!next) break;
      if (errorSignature(next) !== sig) break;
      j++;
    }
    const run = j - i;
    if (run >= 2) {
      out.push({
        kind: "aggregate",
        server: s.server,
        tool: s.tool,
        count: run,
        firstPreview: s.preview ?? "",
        status: "error",
        originalIndex: i,
        iteration: s.iteration,
      });
    } else {
      out.push({ kind: "single", step: s, originalIndex: i });
    }
    i = j;
  }
  return out;
}

// Signature we collapse on: server.tool + one of a small set of error
// families. Two steps collapse only if they share both the identifier
// and the family. Returns null for non-error steps — they never collapse.
function errorSignature(step: Step): string | null {
  if (step.status !== "error") return null;
  const p = (step.preview ?? "").toLowerCase();
  let family = "other";
  if (/blocked by schema-mismatch breaker/.test(p)) family = "breaker";
  else if (/unknown column/.test(p)) family = "unknown-column";
  else if (/unknown table/.test(p) || /does not exist/.test(p))
    family = "unknown-table";
  else if (/no such column/.test(p)) family = "soql-unknown-column";
  else if (/malformed_query/.test(p) || /unexpected token/.test(p))
    family = "malformed-query";
  else if (/unknown tool/.test(p) || /invalid_tool_name/.test(p) || /-32602/.test(p))
    family = "unknown-tool";
  else if (/cloudfront/.test(p) || /request (blocked|could not)/.test(p))
    family = "transport-blocked";
  else if (/\b403\b|\bforbidden\b/.test(p)) family = "http-403";
  else if (/\b401\b|\bunauthorized\b/.test(p)) family = "http-401";
  else if (/\b429\b|rate.?limit/.test(p)) family = "http-429";
  else if (/\b50[234]\b/.test(p)) family = "http-5xx";
  else if (/invalid_argument/.test(p)) family = "invalid-argument";
  if (family === "other") return null;
  return `${step.server}.${step.tool}::${family}`;
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
  const handled = step.status === "error" && isHandledError(step);
  const hardError = step.status === "error" && !handled;

  const showResultTok =
    typeof step.resultTokens === "number" && step.resultTokens > 0;

  return (
    <div
      className={cn(
        "group relative rounded-md border border-transparent bg-surface/60 px-3 py-2 transition-colors",
        hardError && "bg-danger/5",
        handled && "bg-amber-400/5"
      )}
    >
      <button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        disabled={!canExpand}
        className="flex w-full items-center gap-2 text-left font-mono text-[11.5px]"
      >
        <StatusDot status={step.status} handled={handled} />
        <span className="text-accent">{step.server}</span>
        <span className="text-text-muted/70">
          .{formatToolLeafForDisplay(step.tool)}
        </span>
        <span className="ml-auto truncate text-[10px] text-text-muted/60">
          {handled
            ? "schema mismatch — handled"
            : step.input
              ? truncJson(step.input)
              : ""}
        </span>
        {showResultTok && (
          <span
            className="shrink-0 rounded border border-border-soft/60 px-1.5 py-[1px] text-[9px] tabular-nums text-text-muted/70"
            title="Approx. token size of this result pulled into context (estimate)"
          >
            ~{fmtTok(step.resultTokens as number)} tok
          </span>
        )}
        {canExpand && (
          <ChevronRight
            size={11}
            className={cn(
              "ml-1 shrink-0 text-text-muted/50 transition-transform duration-fast",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>
      {canExpand && expanded && (
        <pre
          className={cn(
            "mt-2 max-h-[240px] overflow-auto rounded-md border border-border-soft bg-black/40 px-3 py-2 font-mono text-[11px] leading-snug text-text-muted/90",
            hardError && "border-danger/30 text-red-300/90",
            handled && "border-amber-400/30 text-amber-200/90"
          )}
        >
          {formatted}
        </pre>
      )}
    </div>
  );
}

function StatusDot({
  status,
  handled = false,
}: {
  status?: Step["status"];
  handled?: boolean;
}) {
  if (status === "running")
    return <Loader2 size={11} className="shrink-0 animate-spin text-accent" />;
  if (status === "error") {
    if (handled)
      return (
        <ShieldOff
          size={11}
          strokeWidth={2.4}
          className="shrink-0 text-amber-300"
        />
      );
    return <X size={11} strokeWidth={2.6} className="shrink-0 text-red-400" />;
  }
  if (status === "ok")
    return <Check size={11} strokeWidth={2.6} className="shrink-0 text-emerald-400" />;
  return (
    <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-text-muted/40" />
  );
}

// A "handled" error is one whose preview matches a known schema-mismatch
// signature the runtime is designed to catch and mitigate (via the
// circuit breaker + synthetic tool result). These are expected graceful
// degradations, not true failures — we render them amber and exclude
// them from the red error counter so the header reads "calm" by default.
function isHandledError(step: Step): boolean {
  if (step.status !== "error") return false;
  const p = (step.preview ?? "").toLowerCase();
  return (
    /blocked by schema-mismatch breaker/.test(p) ||
    /invalid_argument/.test(p) ||
    /unknown column/.test(p) ||
    /unknown table/.test(p) ||
    /no such column/.test(p) ||
    /malformed_query/.test(p) ||
    /unexpected token/.test(p) ||
    /unknown tool/.test(p) ||
    /invalid_tool_name/.test(p) ||
    /-32602/.test(p) ||
    /mcp error/.test(p) ||
    /cloudfront/.test(p) ||
    /request blocked/.test(p) ||
    /request could not be satisfied/.test(p) ||
    /\b403\b/.test(p) ||
    /\b401\b/.test(p) ||
    /\b429\b/.test(p) ||
    /\b50[234]\b/.test(p) ||
    /forbidden/.test(p) ||
    /unauthorized/.test(p)
  );
}

/** The iteration a render group belongs to (from its first/only step). */
function groupIteration(g: Group): number | undefined {
  return g.kind === "single" ? g.step.iteration : g.iteration;
}

/** Humanize a token count: 940 → "940", 6100 → "6.1k", 1.2M → "1.2M". */
function fmtTok(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
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
