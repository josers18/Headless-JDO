"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { ArcNode, ArcCluster } from "./ArcNode";
import { ArcTimeline, arcLeftPct } from "./ArcTimeline";
import { ClientDetailSheet } from "./ClientDetailSheet";
import { GhostPrompt } from "./GhostPrompt";
import { BriefRichText } from "./BriefRichText";
import { extractFirstSalesforceId } from "@/lib/salesforce/recordLink";
import { sanitizeProseLite } from "@/lib/safety/sanitize";
import { cn } from "@/lib/utils";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";
import type { ArcNodePayload, TodaysArcPayload } from "@/types/horizon";
import {
  dispatchHorizonFocusClient,
  HORIZON_REFRESH_ARC,
} from "@/lib/client/horizonEvents";
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

function arcRowClientId(n: { client_id?: string; context: string; title: string }):
  | string
  | undefined {
  return (
    n.client_id ??
    extractFirstSalesforceId(n.context) ??
    extractFirstSalesforceId(n.title)
  );
}

function titleShort(s: string): string {
  const w = s.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const all = s.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "";
  return all.length > 3 ? `${w.join(" ")}…` : w.join(" ");
}

export function TodaysArc() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const [awaitingKickoff, setAwaitingKickoff] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{
    clientId: string;
    name?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setAwaitingKickoff(false);
      void start("/api/arc", undefined, { method: "GET" });
    }, AGENT_STAGGER_MS.arc);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [start]);

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

  const isLoading =
    (state === "streaming" || (state === "idle" && awaitingKickoff)) && !arc;

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

  const weekNodes = arc?.lookahead_week ?? [];
  const monthNodes = arc?.lookahead_month ?? [];

  const displayNodes = useMemo((): ArcNodePayload[] => {
    if (!arc) return [];
    const base = [...arc.nodes];
    const wins = arc.recommended_windows ?? [];
    for (let i = 0; i < wins.length; i++) {
      const w = wins[i];
      if (!w) continue;
      const t = Date.parse(w.start);
      if (Number.isNaN(t)) continue;
      const dup = base.some(
        (n) => Math.abs(Date.parse(n.start) - t) < 120_000
      );
      if (dup) continue;
      base.push({
        id: `rw-${i}-${w.start}`,
        type: "recommended",
        start: w.start,
        duration_minutes: w.duration_minutes,
        title: titleShort(w.suggestion) || "Focus window",
        context: w.suggestion,
      });
    }
    return sortArcNodesByStart(base).slice(0, 8);
  }, [arc]);

  const selected = useMemo(
    () => displayNodes.find((x) => x.id === selectedId) ?? null,
    [displayNodes, selectedId]
  );

  const activateNode = useCallback(
    (node: ArcNodePayload) => {
      const scid = arcRowClientId(node);
      if (scid) {
        const name = titleShort(node.title) || "Client";
        dispatchHorizonFocusClient({ name, clientId: scid });
        setSheet({ clientId: scid, name });
        setSelectedId(null);
      } else {
        setSheet(null);
        setSelectedId((id) => (id === node.id ? null : node.id));
      }
    },
    []
  );

  const nowRailPct = useMemo(() => {
    const span = endMs - nowMs;
    if (span <= 0) return 0;
    const t = Date.now();
    const u = Math.min(endMs, Math.max(nowMs, t));
    return ((u - nowMs) / span) * 100;
  }, [nowMs, endMs]);

  // ISSUE 2 (A) — "Wrapping up today" state. When ≤ 30 minutes
  // remain until end_of_day the timeline compresses so hard every
  // node collapses onto the same x-coordinate. Instead of drawing
  // a broken axis, show a concierge line + a compact list. The
  // threshold is measured against `endMs`, not `Date.now()`, so it
  // stays correct whether the agent used business hours (6pm) or a
  // later wall-clock end.
  const remainingMinutes = useMemo(() => {
    if (!arc || !endMs) return Number.POSITIVE_INFINITY;
    const ms = endMs - Date.now();
    return ms / 60_000;
  }, [arc, endMs]);
  const isWrappingUp = remainingMinutes <= 30 && remainingMinutes > -60;

  // ISSUE 2 (C) — Collision clustering. Any two nodes whose leftPct
  // differ by less than this threshold get folded into an ArcCluster
  // so their labels stop overlapping. 4% of a 520px-wide track is
  // ~21px, roughly a dot diameter + a hair of breathing room.
  const CLUSTER_PCT_THRESHOLD = 4;

  const renderGroups = useMemo(() => {
    if (!arc || !nowMs || !endMs) return [];
    type Group = { leftPct: number; nodes: ArcNodePayload[] };
    const withPct = displayNodes
      .map((n) => {
        const ev = Date.parse(n.start);
        if (Number.isNaN(ev)) return null;
        return { node: n, leftPct: arcLeftPct(nowMs, endMs, ev) };
      })
      .filter((x): x is { node: ArcNodePayload; leftPct: number } => x !== null)
      .sort((a, b) => a.leftPct - b.leftPct);

    const groups: Group[] = [];
    for (const { node, leftPct } of withPct) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.leftPct - leftPct) < CLUSTER_PCT_THRESHOLD) {
        last.nodes.push(node);
        // Re-center the group so subsequent nodes compare against the
        // running mean, not the first bucket's anchor.
        last.leftPct =
          (last.leftPct * (last.nodes.length - 1) + leftPct) /
          last.nodes.length;
      } else {
        groups.push({ leftPct, nodes: [node] });
      }
    }
    return groups;
  }, [displayNodes, nowMs, endMs, arc]);

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

      {arc && nowMs && endMs && !isWrappingUp && (
        <div className="mt-6 animate-fade-rise">
          <div className="overflow-x-auto overscroll-x-contain pb-2 [-webkit-overflow-scrolling:touch] snap-x snap-mandatory md:snap-none md:overflow-visible">
            <div className="relative min-w-[min(100%,520px)] snap-center md:min-w-0">
              <ArcTimeline
                nowMs={nowMs}
                endMs={endMs}
                nowRailPct={nowRailPct}
                tz={tz}
              >
                {renderGroups.map((group) => {
                  if (group.nodes.length === 1) {
                    const node = group.nodes[0]!;
                    return (
                      <ArcNode
                        key={node.id}
                        node={node}
                        leftPct={group.leftPct}
                        selected={selectedId === node.id}
                        onActivate={() => activateNode(node)}
                        onRescheduleIntent={onRescheduleIntent}
                      />
                    );
                  }
                  // Cluster — uses a synthetic id derived from its
                  // members so selection survives a re-render as long
                  // as the bucket composition is stable.
                  const clusterId = `cluster:${group.nodes
                    .map((n) => n.id)
                    .join("|")}`;
                  return (
                    <ArcCluster
                      key={clusterId}
                      nodes={group.nodes}
                      leftPct={group.leftPct}
                      selected={selectedId === clusterId}
                      onActivate={() =>
                        setSelectedId((id) =>
                          id === clusterId ? null : clusterId
                        )
                      }
                      onSelectChild={(n) => {
                        setSelectedId(null);
                        activateNode(n);
                      }}
                    />
                  );
                })}
              </ArcTimeline>

              {displayNodes.length === 0 && (
                <p className="mt-2 text-center text-[11px] text-text-muted/80">
                  No timed items on the arc yet — suggested focus below.
                </p>
              )}

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
                          text={sanitizeProseLite(w.suggestion)}
                          clientId={extractFirstSalesforceId(w.suggestion)}
                          probeCoListedNames
                        />
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {/* B-2 — "This week" and "This month" lookaheads moved into
                  the Priority Queue's tiered groups below (Today /
                  This week / Watch). Keeping them here duplicated the
                  data and added scroll noise. The Arc stays about *today's*
                  shape only. */}
            </div>
          </div>
        </div>
      )}

      {/* ISSUE 2 (A) — Wrapping-up state. Replaces the timeline
          entirely when less than ~30 minutes remain until end_of_day,
          since a 5-minute window cannot meaningfully render a
          chronological axis. Shows a concierge line + a compact
          stacked list of the day's remaining items. Suggested-focus
          windows (if any) render below, matching the normal layout. */}
      {arc && nowMs && endMs && isWrappingUp && (
        <div className="mt-6 animate-fade-rise">
          <div className="rounded-xl border border-border-soft/70 bg-gradient-to-b from-surface/50 to-black/20 px-5 py-4 shadow-inner">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-[18px] leading-tight tracking-tight text-text">
                Wrapping up today.
              </p>
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-text-muted">
                {remainingMinutes > 0
                  ? `${Math.max(1, Math.round(remainingMinutes))} min left`
                  : "Day closed"}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
              {displayNodes.length === 0
                ? "Nothing left on the calendar. Tomorrow starts fresh."
                : displayNodes.length === 1
                  ? "One item still open before the day closes."
                  : `${displayNodes.length} items still open before the day closes.`}
            </p>

            {displayNodes.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {displayNodes.map((n) => {
                  const scid = arcRowClientId(n);
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => activateNode(n)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-surface2/60"
                      >
                        <span className="w-[68px] shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/90">
                          {new Date(
                            Number.isFinite(Date.parse(n.start))
                              ? Date.parse(n.start)
                              : Date.now()
                          ).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                        <span className="truncate text-[13px] text-text">
                          <BriefRichText
                            text={n.title}
                            clientId={scid}
                            probeCoListedNames
                          />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

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
                      text={sanitizeProseLite(w.suggestion)}
                      clientId={extractFirstSalesforceId(w.suggestion)}
                      probeCoListedNames
                    />
                  </p>
                </li>
              ))}
            </ul>
          )}
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

      {sheet && (
        <ClientDetailSheet
          clientId={sheet.clientId}
          clientName={sheet.name}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
