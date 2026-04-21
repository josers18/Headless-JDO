"use client";

import { useMemo, type ReactNode } from "react";

/** Position on the arc track: 0% = `now`, 100% = `end_of_day`. */
export function arcLeftPct(nowMs: number, endMs: number, eventMs: number): number {
  if (Number.isNaN(eventMs)) return 50;
  const span = endMs - nowMs;
  if (span <= 0) return 50;
  const p = ((eventMs - nowMs) / span) * 100;
  if (Number.isNaN(p)) return 50;
  return Math.min(98.5, Math.max(0.5, p));
}

function hourBoundaryMs(nowMs: number, endMs: number): number[] {
  const out: number[] = [];
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  d.setSeconds(0, 0);
  d.setMilliseconds(0);
  let t = d.getTime();
  while (t <= nowMs) {
    t += 60 * 60 * 1000;
  }
  while (t < endMs && out.length < 24) {
    out.push(t);
    t += 60 * 60 * 1000;
  }
  return out;
}

function formatTick(ms: number, tz?: string): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  });
}

const TRACK_LINE_PX = 52;

/**
 * Horizontal workday track: hourly grid, baseline, pulsing NOW marker, node overlay.
 * Children should be absolutely positioned nodes (e.g. {@link ArcNode}).
 */
export function ArcTimeline({
  nowMs,
  endMs,
  nowRailPct,
  tz,
  children,
}: {
  nowMs: number;
  endMs: number;
  nowRailPct: number;
  tz?: string;
  children: ReactNode;
}) {
  const hourMs = useMemo(
    () => hourBoundaryMs(nowMs, endMs),
    [nowMs, endMs]
  );

  return (
    <div className="w-full select-none">
      <div className="mb-2 flex justify-between gap-2 px-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/90">
        <span className="shrink-0 text-accent-2/95">Now</span>
        <span className="hidden min-[420px]:inline">
          {formatTick(nowMs + (endMs - nowMs) * 0.33, tz)}
        </span>
        <span className="hidden sm:inline">
          {formatTick(nowMs + (endMs - nowMs) * 0.55, tz)}
        </span>
        <span className="shrink-0">{formatTick(endMs, tz)}</span>
      </div>

      <div
        className="relative overflow-hidden rounded-xl border border-border-soft/70 bg-gradient-to-b from-surface/50 to-black/20 px-[1%] shadow-inner"
        style={{ height: 100 }}
      >
        {hourMs.map((hm) => (
          <div
            key={hm}
            className="pointer-events-none absolute bottom-2 top-5 w-px bg-border-soft/45"
            style={{
              left: `${arcLeftPct(nowMs, endMs, hm)}%`,
              transform: "translateX(-50%)",
            }}
            aria-hidden
          />
        ))}

        <div
          className="pointer-events-none absolute left-[0.5%] right-[0.5%] rounded-full bg-gradient-to-r from-accent/30 via-border-soft to-border-soft/80 shadow-[0_0_12px_rgba(91,141,239,0.12)]"
          style={{ top: TRACK_LINE_PX, height: 2 }}
          aria-hidden
        />

        <div
          className="pointer-events-none absolute z-30 w-[3px] -translate-x-1/2 rounded-full bg-accent shadow-[0_0_20px_rgba(91,141,239,0.65)] animate-pulse motion-reduce:animate-none"
          style={{
            left: `${Math.min(98.5, Math.max(0.8, nowRailPct))}%`,
            top: 12,
            bottom: 28,
          }}
          aria-hidden
        />

        <div className="pointer-events-none absolute bottom-1 left-0 right-0 flex justify-between px-1">
          {hourMs.slice(0, 8).map((hm) => (
            <span
              key={hm}
              className="font-mono text-[9px] tabular-nums text-text-muted/55"
              style={{
                position: "absolute",
                left: `${arcLeftPct(nowMs, endMs, hm)}%`,
                transform: "translateX(-50%)",
              }}
            >
              {formatTick(hm, tz)}
            </span>
          ))}
        </div>

        <div
          className="absolute inset-x-0 top-0 z-20"
          style={{ height: TRACK_LINE_PX + 24 }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export const ARC_TRACK_LINE_PX = TRACK_LINE_PX;
