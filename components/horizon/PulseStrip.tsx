"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "@/components/horizon/ReasoningTrail";
import { cn } from "@/lib/utils";
import { PULSE_REFRESH_EVENT } from "@/lib/client/rightNowSnooze";
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

function fallbackStripLine(p: PulseStripPayload): string {
  const parts: string[] = [];
  parts.push(p.temperature_label || p.temperature);
  parts.push(`${p.review_count} to review`);
  if (p.next_event && p.next_event.time && p.next_event.label) {
    parts.push(`Next: ${p.next_event.time} ${p.next_event.label}`);
  }
  if (p.flag_count > 0) {
    parts.push(
      `${p.flag_count} need attention${p.flag_deadline ? ` ${p.flag_deadline}` : ""}`
    );
  } else {
    parts.push("0 flags");
  }
  return parts.join(" · ");
}

function temperatureStyles(t: PulseStripTemperature): {
  dot: string;
  label: string;
} {
  if (t === "URGENT") {
    return {
      dot: "bg-danger shadow-[0_0_12px_rgba(248,113,113,0.45)]",
      label: "text-danger/95",
    };
  }
  if (t === "ATTENTION") {
    return {
      dot: "bg-[#F5A524] shadow-[0_0_10px_rgba(245,165,36,0.35)]",
      label: "text-amber-200/95",
    };
  }
  return {
    dot: "bg-emerald-400/90 shadow-[0_0_8px_rgba(74,222,128,0.25)]",
    label: "text-emerald-200/90",
  };
}

/**
 * UI v2 T0-1 — single-row flight-deck read; sticky wrapper lives in page.tsx.
 */
export function PulseStrip() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const [hasStarted, setHasStarted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastRefetchRef = useRef(0);

  const runFetch = useCallback(() => {
    void start("/api/pulse-strip", undefined, { method: "GET" });
  }, [start]);

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    runFetch();
  }, [hasStarted, runFetch]);

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
          {/* Desktop / tablet: full strip */}
          <div className="hidden items-center gap-3 md:flex md:gap-4">
            <span
              className={cn(
                "inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/10",
                styles.dot
              )}
              aria-hidden
            />
            <p
              className={cn(
                "min-w-0 flex-1 font-mono text-[12px] leading-snug tracking-tight text-text/95 md:text-[13px]",
                styles.label
              )}
            >
              {displayLine}
            </p>
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
                  "inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-white/10",
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
                  "mt-2 border-t border-border-soft/60 pt-2 font-mono text-[12px] leading-snug text-text/90",
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
