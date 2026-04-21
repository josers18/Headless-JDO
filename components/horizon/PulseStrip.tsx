"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "@/components/horizon/ReasoningTrail";
import { cn } from "@/lib/utils";
import { PULSE_REFRESH_EVENT } from "@/lib/client/rightNowSnooze";
import { dispatchAction } from "@/lib/client/actions/registry";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";
import type {
  PulseStripPayload,
  PulseStripTemperature,
} from "@/types/horizon";

function isPulseStripPayload(v: unknown): v is PulseStripPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const temp = o.temperature;
  if (temp !== "QUIET" && temp !== "ATTENTION" && temp !== "URGENT") {
    return false;
  }
  if (typeof o.strip_line !== "string") return false;
  const rc = o.review_count;
  const fc = o.flag_count;
  if (typeof rc !== "number" && typeof rc !== "string") return false;
  if (typeof fc !== "number" && typeof fc !== "string") return false;
  if (typeof o.temperature_label !== "string") return false;
  const ne = o.next_event;
  if (ne != null && (typeof ne !== "object" || typeof (ne as { time?: unknown }).time !== "string")) {
    return false;
  }
  return true;
}

function coercePayload(raw: PulseStripPayload): PulseStripPayload {
  return {
    ...raw,
    review_count: Number(raw.review_count) || 0,
    flag_count: Number(raw.flag_count) || 0,
  };
}

/**
 * F-5 fallback renderer — flight-deck callout style.
 * Rules: ALL-CAPS label leads · ≤ 4 segments · 2–4 words each · positives over
 * negatives. Used only when the model's strip_line is empty.
 */
function fallbackStripLine(p: PulseStripPayload): string {
  const parts: string[] = [];
  parts.push((p.temperature_label || p.temperature).toUpperCase());
  if (p.review_count > 0) {
    parts.push(`${p.review_count} to review`);
  } else {
    parts.push("calendar clear");
  }
  if (p.next_event && p.next_event.time && p.next_event.label) {
    parts.push(`next ${p.next_event.time} ${p.next_event.label}`);
  } else {
    parts.push("open afternoon");
  }
  if (p.flag_count > 0) {
    const deadline = p.flag_deadline ? ` ${p.flag_deadline}` : "";
    parts.push(`${p.flag_count} need attention${deadline}`);
  }
  return parts.slice(0, 4).join(" · ");
}

function temperatureStyles(t: PulseStripTemperature): {
  dot: string;
  label: string;
} {
  if (t === "URGENT") {
    return {
      dot: "bg-danger shadow-[0_0_12px_color-mix(in_srgb,var(--hz-danger)_45%,transparent)]",
      label: "font-medium text-danger",
    };
  }
  if (t === "ATTENTION") {
    return {
      dot: "bg-warn shadow-[0_0_10px_color-mix(in_srgb,var(--hz-warn)_40%,transparent)]",
      label: "font-medium text-warn",
    };
  }
  return {
    dot: "bg-success shadow-[0_0_8px_color-mix(in_srgb,var(--hz-success)_35%,transparent)]",
    label: "font-medium text-success",
  };
}

/**
 * UI v2 T0-1 — single-row flight-deck read; sticky wrapper lives in page.tsx.
 */
export function PulseStrip() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastRefetchRef = useRef(0);

  const runFetch = useCallback(() => {
    void start("/api/pulse-strip", undefined, { method: "GET" });
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      runFetch();
    }, AGENT_STAGGER_MS.pulseStrip);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [runFetch]);

  const refetchSoft = useCallback(() => {
    const now = Date.now();
    if (now - lastRefetchRef.current < 45_000) return;
    lastRefetchRef.current = now;
    reset();
    runFetch();
  }, [reset, runFetch]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") refetchSoft();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refetchSoft]);

  useEffect(() => {
    const onPulse = () => {
      lastRefetchRef.current = 0;
      reset();
      runFetch();
    };
    window.addEventListener(PULSE_REFRESH_EVENT, onPulse);
    return () => window.removeEventListener(PULSE_REFRESH_EVENT, onPulse);
  }, [reset, runFetch]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => {
      if (mq.matches) setMobileOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const data = useMemo(() => {
    const raw = tryParseJson<unknown>(narrative);
    if (!raw || !isPulseStripPayload(raw)) return null;
    return coercePayload(raw);
  }, [narrative]);

  const displayLine = useMemo(() => {
    if (!data) return "";
    const line = data.strip_line.trim();
    if (line.length > 0) return line;
    return fallbackStripLine(data);
  }, [data]);

  const styles = data ? temperatureStyles(data.temperature) : null;
  const isLoading = state === "streaming" && !data;
  const showTrail = steps.length > 0;

  return (
    <div className="rounded-xl border border-border-soft/70 bg-surface/40 px-3 py-2.5 md:border-0 md:bg-transparent md:px-0 md:py-0">
      {error && (
        <p className="text-[12px] text-danger/90" role="alert">
          {error}
        </p>
      )}

      {isLoading && !error && (
        <div className="flex items-center gap-3 md:gap-4">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-text-muted/40 animate-pulse" />
          <div className="h-3.5 flex-1 max-w-xl rounded shimmer" />
        </div>
      )}

      {data && styles && (
        <>
          {/* Desktop / tablet: full strip with tappable segments (A-5). */}
          <div className="hidden items-center gap-3 md:flex md:gap-4">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-border/50",
                styles.dot
              )}
              aria-hidden
            />
            <TappableStripLine
              line={displayLine}
              data={data}
              labelClass={styles.label}
            />
          </div>

          {/* Mobile: compact */}
          <div className="md:hidden">
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              className="flex w-full items-center gap-3 text-left"
              aria-expanded={mobileOpen}
              aria-controls="pulse-strip-expanded"
            >
              <span
                className={cn(
                  "inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-border/50",
                  styles.dot
                )}
                aria-hidden
              />
              <span className="font-mono text-[12px] text-text/90">
                {data.review_count} to review
              </span>
              <span className="ml-auto flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {data.temperature}
                {mobileOpen ? (
                  <ChevronUp size={14} className="opacity-70" />
                ) : (
                  <ChevronDown size={14} className="opacity-70" />
                )}
              </span>
            </button>
            {mobileOpen && (
              <p
                id="pulse-strip-expanded"
                className={cn(
                  "mt-2 border-t border-border-soft/60 pt-2 font-mono text-[12px] leading-snug",
                  styles.label
                )}
              >
                {displayLine}
              </p>
            )}
          </div>
        </>
      )}

      {showTrail && (
        <div className="mt-2 md:mt-3">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}

/**
 * A-5 — split the strip on " · " separators and render each segment as a
 * button when its text maps to a known action intent. Segments we
 * recognize:
 *   - "X to review"       → show overdue/today tasks list via AskBar
 *   - "next 3:30 PM Patel"→ open that calendar touchpoint (investigate)
 *   - "X need attention"  → pull the flag list into AskBar
 * Anything unrecognized stays plain text so the line reads cleanly.
 */
function TappableStripLine({
  line,
  data,
  labelClass,
}: {
  line: string;
  data: PulseStripPayload;
  labelClass: string;
}) {
  const segs = line.split(" · ");
  return (
    <p
      className={cn(
        "min-w-0 flex-1 font-mono text-[12px] leading-snug tracking-tight md:text-[13px]",
        labelClass
      )}
    >
      {segs.map((raw, i) => {
        const trimmed = raw.trim();
        const intent = classifyStripSegment(trimmed, data);
        const sep = i > 0 ? <span className="text-text-muted/40"> · </span> : null;
        if (!intent) {
          return (
            <span key={i}>
              {sep}
              {trimmed}
            </span>
          );
        }
        return (
          <span key={i}>
            {sep}
            <button
              type="button"
              onClick={() => void dispatchAction(intent.action)}
              className="rounded px-1 py-[1px] text-left underline decoration-transparent decoration-dotted underline-offset-2 transition hover:bg-surface2/60 hover:decoration-current"
              title={intent.title}
            >
              {trimmed}
            </button>
          </span>
        );
      })}
    </p>
  );
}

function classifyStripSegment(
  seg: string,
  data: PulseStripPayload
):
  | {
      title: string;
      action: import("@/lib/client/actions/registry").HorizonAction;
    }
  | null {
  if (/to review/i.test(seg) && data.review_count > 0) {
    return {
      title: "Show the items I need to review",
      action: {
        kind: "investigate",
        label: "Review",
        question: `Show me the ${data.review_count} items I need to review today — tasks due, events starting, and opportunities closing. Rank by urgency.`,
      },
    };
  }
  if (/^next /i.test(seg) && data.next_event) {
    const ne = data.next_event;
    return {
      title: "Prep me for this touchpoint",
      action: {
        kind: "investigate",
        label: "Prep",
        question: `Prep me for my ${ne.time} with ${ne.label}. What's changed since our last touch, what should I lead with, and what are the risks?`,
      },
    };
  }
  if (/(need attention|flag)/i.test(seg) && data.flag_count > 0) {
    return {
      title: "Show the flagged items",
      action: {
        kind: "investigate",
        label: "Flags",
        question: `Walk me through the ${data.flag_count} flagged items${data.flag_deadline ? ` before ${data.flag_deadline}` : ""}. What's the risk on each?`,
      },
    };
  }
  if (/(overdue|long-overdue)/i.test(seg)) {
    return {
      title: "Triage overdue items",
      action: {
        kind: "investigate",
        label: "Overdue",
        question: `Triage my overdue tasks. Group by client and recommend which to close, reschedule, or drop.`,
      },
    };
  }
  return null;
}
