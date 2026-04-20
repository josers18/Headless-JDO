"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { ArcNode } from "./ArcNode";
import { GhostPrompt } from "./GhostPrompt";
import { cn } from "@/lib/utils";
import type { ArcNodePayload, TodaysArcPayload } from "@/types/horizon";
import { HORIZON_REFRESH_ARC } from "@/lib/client/horizonEvents";
import { vibrateLight } from "@/lib/gestures";

function isArcPayload(v: unknown): v is TodaysArcPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.now !== "string" || typeof o.end_of_day !== "string") {
    return false;
  }
  if (!Array.isArray(o.nodes)) return false;
  return true;
}

function leftPct(nowMs: number, endMs: number, startIso: string): number {
  const s = Date.parse(startIso);
  if (Number.isNaN(s)) return 50;
  const span = endMs - nowMs;
  if (span <= 0) return 50;
  return ((s - nowMs) / span) * 100;
}

function formatTick(
  nowMs: number,
  endMs: number,
  frac: number,
  tz?: string
): string {
  const t = new Date(nowMs + (endMs - nowMs) * frac);
  return t.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

export function TodaysArc() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const [hasStarted, setHasStarted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    void start("/api/arc", undefined, { method: "GET" });
  }, [hasStarted, start]);

  useEffect(() => {
    const fn = () => {
      reset();
      void start("/api/arc", undefined, { method: "GET" });
    };
    window.addEventListener(HORIZON_REFRESH_ARC, fn);
    return () => window.removeEventListener(HORIZON_REFRESH_ARC, fn);
  }, [reset, start]);

  const onRescheduleIntent = useCallback((node: ArcNodePayload, deltaX: number) => {
    vibrateLight();
    void fetch("/api/arc-drag", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nodeId: node.id,
        title: node.title,
        deltaPx: deltaX,
        intent: "reschedule",
      }),
    }).catch(() => {});
  }, []);

  const arc = useMemo(() => {
    const raw = tryParseJson<unknown>(narrative);
    if (!raw || !isArcPayload(raw)) return null;
    return raw;
  }, [narrative]);

  const isLoading = state === "streaming" && !arc;

  const { nowMs, endMs, tz } = useMemo(() => {
    if (!arc) return { nowMs: 0, endMs: 0, tz: undefined as string | undefined };
    const n = Date.parse(arc.now);
    const e = Date.parse(arc.end_of_day);
    return {
      nowMs: Number.isNaN(n) ? Date.now() : n,
      endMs: Number.isNaN(e) ? Date.now() + 36e5 * 4 : e,
      tz: undefined,
    };
  }, [arc]);

  const selected = useMemo(
    () => arc?.nodes.find((x) => x.id === selectedId) ?? null,
    [arc, selectedId]
  );

  return (
    <div data-horizon-section="arc">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent-2/80",
              isLoading && "animate-glow-pulse"
            )}
          />
          Today&apos;s arc
        </h2>
        {isLoading && steps.length > 0 && (
          <span className="font-mono text-[10px] text-text-muted/70">
            {steps.length} MCP call{steps.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
          {error}
        </div>
      )}

      {arc && arc.nodes.length > 0 && (
        <div className="mt-4">
          <GhostPrompt
            text="What should I move on the arc to protect focus time?"
            context="The banker is viewing Today's arc timeline."
          />
        </div>
      )}

      {isLoading && !error && (
        <div className="mt-6 space-y-3">
          <div className="h-4 w-full max-w-md rounded shimmer" />
          <div className="h-[100px] w-full rounded-xl shimmer" />
        </div>
      )}

      {arc && nowMs && endMs && (
        <div className="mt-6 animate-fade-rise">
          <div className="overflow-x-auto overscroll-x-contain pb-2 [-webkit-overflow-scrolling:touch] snap-x snap-mandatory md:snap-none md:overflow-visible">
            <div className="relative min-h-[120px] min-w-[520px] snap-center md:min-w-0">
              <div className="flex justify-between px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/80">
                <span>Now</span>
                <span className="hidden sm:inline">
                  {formatTick(nowMs, endMs, 0.33, tz)}
                </span>
                <span className="hidden md:inline">
                  {formatTick(nowMs, endMs, 0.55, tz)}
                </span>
                <span>{formatTick(nowMs, endMs, 1, tz)}</span>
              </div>

              <div className="relative mt-3 h-[72px] rounded-xl border border-border-soft/60 bg-surface/30">
                <div
                  className="pointer-events-none absolute bottom-0 left-0 right-0 top-8 border-t border-border-soft/50"
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute bottom-0 left-0 top-8 w-px bg-accent/70 shadow-[0_0_12px_rgba(91,141,239,0.45)] animate-pulse"
                  style={{ left: "0%" }}
                  aria-hidden
                />
                {arc.nodes.map((node, i) => (
                  <div
                    key={node.id}
                    className="animate-fade-rise"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <ArcNode
                      node={node}
                      leftPct={leftPct(nowMs, endMs, node.start)}
                      selected={selectedId === node.id}
                      onSelect={() =>
                        setSelectedId((id) => (id === node.id ? null : node.id))
                      }
                      onRescheduleIntent={onRescheduleIntent}
                    />
                  </div>
                ))}
              </div>

              {selected && (
                <div className="mt-4 rounded-lg border border-border-soft bg-surface2/50 px-4 py-3 text-[13px] leading-relaxed animate-fade-in">
                  <div className="font-medium text-text">{selected.title}</div>
                  <p className="mt-1.5 text-text-muted">{selected.context}</p>
                  {selected.client_id && (
                    <p className="mt-2 font-mono text-[10px] text-text-muted/70">
                      Client: {selected.client_id}
                    </p>
                  )}
                </div>
              )}

              {arc.recommended_windows && arc.recommended_windows.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {arc.recommended_windows.map((w, i) => (
                    <li
                      key={`${w.start}-${i}`}
                      className="rounded-md border border-border-soft/60 bg-black/15 px-3 py-2 text-[12px] text-text-muted"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent/90">
                        Window
                      </span>
                      <p className="mt-1 text-text/90">{w.suggestion}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {!isLoading &&
        arc &&
        arc.nodes.length === 0 &&
        !(arc.recommended_windows && arc.recommended_windows.length > 0) && (
          <p className="mt-6 max-w-prose text-[14px] italic leading-relaxed text-text-muted">
            Your day is open. Want to suggest 3 productive uses of the afternoon?
          </p>
        )}

      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}
