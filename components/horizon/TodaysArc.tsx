"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { ArcNode } from "./ArcNode";
import { GhostPrompt } from "./GhostPrompt";
import { BriefRichText } from "./BriefRichText";
import { extractFirstSalesforceId } from "@/lib/salesforce/recordLink";
import { cn } from "@/lib/utils";
import type { ArcNodePayload, TodaysArcPayload } from "@/types/horizon";
import { HORIZON_REFRESH_ARC } from "@/lib/client/horizonEvents";
import { vibrateLight } from "@/lib/gestures";

function isArcNodePayload(o: unknown): o is ArcNodePayload {
  if (!o || typeof o !== "object") return false;
  const x = o as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.type === "string" &&
    typeof x.start === "string" &&
    typeof x.duration_minutes === "number" &&
    typeof x.title === "string" &&
    typeof x.context === "string"
  );
}

function sortArcNodesByStart(nodes: ArcNodePayload[]): ArcNodePayload[] {
  return [...nodes].sort((a, b) => {
    const ta = Date.parse(a.start);
    const tb = Date.parse(b.start);
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return ta - tb;
  });
}

function isArcPayload(v: unknown): v is TodaysArcPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  if (typeof o.now !== "string" || typeof o.end_of_day !== "string") {
    return false;
  }
  if (!Array.isArray(o.nodes) || !o.nodes.every(isArcNodePayload)) return false;
  if (o.lookahead_week != null && !Array.isArray(o.lookahead_week)) return false;
  if (o.lookahead_month != null && !Array.isArray(o.lookahead_month)) return false;
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

/** Normalize odd model `type` values (e.g. WINDOW) for the small badge chip. */
function displayArcNodeType(type: string): string {
  const key = type.trim().toLowerCase().replace(/\s+/g, "_");
  const map: Record<string, string> = {
    event: "Event",
    deadline: "Deadline",
    recommended: "Focus",
    blocked: "Blocked",
    window: "Focus window",
  };
  return map[key] ?? type.replace(/_/g, " ");
}

function arcRowClientId(n: { client_id?: string; context: string; title: string }):
  | string
  | undefined {
  return (
    n.client_id ??
    extractFirstSalesforceId(n.context) ??
    extractFirstSalesforceId(n.title)
  );
}

function formatArcWhen(iso: string, tz?: string): string {
  const d = Date.parse(iso);
  if (Number.isNaN(d)) return iso;
  return new Date(d).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

function ArcLookaheadSection({
  title,
  subtitle,
  nodes,
  tz,
}: {
  title: string;
  subtitle: string;
  nodes: ArcNodePayload[];
  tz?: string;
}) {
  if (!nodes.length) return null;
  return (
    <section className="mt-8 border-t border-border-soft/40 pt-6">
      <h3 className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-muted">
        {title}
      </h3>
      <p className="mt-1 text-[11px] leading-relaxed text-text-muted/80">
        {subtitle}
      </p>
      <ul className="mt-3 space-y-2">
        {nodes.map((n) => (
          <li
            key={n.id}
            className="rounded-lg border border-border-soft/50 bg-surface/35 px-3 py-2.5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-text-muted">
                {formatArcWhen(n.start, tz)}
              </span>
              <span className="rounded border border-border-soft px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted/80">
                {displayArcNodeType(n.type)}
              </span>
            </div>
            <div className="mt-1.5 text-[13px] font-medium text-text">
              <BriefRichText
                text={n.title}
                clientId={arcRowClientId(n)}
                probeCoListedNames
              />
            </div>
            <div className="mt-1 text-[12px] leading-snug text-text-muted">
              <BriefRichText
                text={n.context}
                clientId={arcRowClientId(n)}
                probeCoListedNames
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
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

  const arc = useMemo((): TodaysArcPayload | null => {
    const raw = tryParseJson<unknown>(narrative);
    if (!raw || !isArcPayload(raw)) return null;
    const week = Array.isArray(raw.lookahead_week)
      ? raw.lookahead_week.filter(isArcNodePayload)
      : [];
    const month = Array.isArray(raw.lookahead_month)
      ? raw.lookahead_month.filter(isArcNodePayload)
      : [];
    return {
      ...raw,
      lookahead_week: sortArcNodesByStart(week),
      lookahead_month: sortArcNodesByStart(month),
    };
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

  const weekNodes = arc?.lookahead_week ?? [];
  const monthNodes = arc?.lookahead_month ?? [];

  const nowRailPct = useMemo(() => {
    const span = endMs - nowMs;
    if (span <= 0) return 0;
    const t = Date.now();
    const u = Math.min(endMs, Math.max(nowMs, t));
    return ((u - nowMs) / span) * 100;
  }, [nowMs, endMs]);

  const hasArcContent =
    !!arc &&
    (arc.nodes.length > 0 ||
      weekNodes.length > 0 ||
      monthNodes.length > 0 ||
      (arc.recommended_windows?.length ?? 0) > 0);

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

      {hasArcContent && (
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
                  style={{
                    left: `${Math.min(98, Math.max(2, nowRailPct))}%`,
                    transform: "translateX(-50%)",
                  }}
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

              {selected &&
                (() => {
                  const scid = arcRowClientId(selected);
                  return (
                    <div className="mt-4 rounded-lg border border-border-soft bg-surface2/50 px-4 py-3 text-[13px] leading-relaxed animate-fade-in">
                      <div className="font-medium text-text">
                        <BriefRichText
                          text={selected.title}
                          clientId={scid}
                          probeCoListedNames
                        />
                      </div>
                      <p className="mt-1.5 text-text-muted">
                        <BriefRichText
                          text={selected.context}
                          clientId={scid}
                          probeCoListedNames
                        />
                      </p>
                      {scid && (
                        <p className="mt-2 font-mono text-[10px] text-text-muted/70">
                          <BriefRichText
                            text={`Client: ${scid}`}
                            clientId={scid}
                            probeCoListedNames
                          />
                        </p>
                      )}
                    </div>
                  );
                })()}

              {arc.recommended_windows && arc.recommended_windows.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {arc.recommended_windows.map((w, i) => (
                    <li
                      key={`${w.start}-${i}`}
                      className="rounded-md border border-border-soft/60 bg-black/15 px-3 py-2 text-[12px] text-text-muted"
                    >
                      <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-accent/90">
                        Suggested focus
                      </span>
                      <p className="mt-1 text-text/90">
                        <BriefRichText
                          text={w.suggestion}
                          clientId={extractFirstSalesforceId(w.suggestion)}
                          probeCoListedNames
                        />
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              <ArcLookaheadSection
                title="This week"
                subtitle="Next 7 days after today — meetings, tasks, and closes from your tools."
                nodes={weekNodes}
                tz={tz}
              />
              <ArcLookaheadSection
                title="This month"
                subtitle="Further out (about days 8–30) so late days still show momentum."
                nodes={monthNodes}
                tz={tz}
              />
            </div>
          </div>
        </div>
      )}

      {!isLoading &&
        arc &&
        arc.nodes.length === 0 &&
        weekNodes.length === 0 &&
        monthNodes.length === 0 &&
        !(arc.recommended_windows && arc.recommended_windows.length > 0) && (
          <p className="mt-6 max-w-prose text-[14px] italic leading-relaxed text-text-muted">
            Nothing on the calendar for the rest of today. Pull to refresh after
            you update Salesforce, or sign in again if the session expired.
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
