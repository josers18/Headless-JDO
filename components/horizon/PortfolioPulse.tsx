"use client";

import { useEffect, useMemo, useState } from "react";
import { HORIZON_REFRESH_PULSE } from "@/lib/client/horizonEvents";
import { ArrowDownRight, ArrowUpRight, Minus, Play, Square, Volume2 } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { applyPulseHygieneToKpis } from "@/lib/client/pulseMetricHygiene";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { GhostPrompt } from "./GhostPrompt";
import { cn } from "@/lib/utils";
import { dispatchAction } from "@/lib/client/actions/registry";

interface Pulse {
  narrative: string;
  kpis: Array<{
    label: string;
    value: string;
    delta: string;
    direction: "up" | "down" | "flat";
    explanation?: string;
  }>;
}

// PortfolioPulse narrates 2–3 KPIs sourced from tableau_next. The voice
// playback piggybacks on the same hook Morning Brief uses — two of our
// "protect at all costs" features share the same surface for narration.
export function PortfolioPulse() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const { supported: voiceSupported, speaking, play, stop } =
    useSpokenNarration();
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    start("/api/pulse", undefined, { method: "GET" }).catch(() => {});
  }, [hasStarted, start]);

  useEffect(() => {
    const fn = () => {
      reset();
      void start("/api/pulse", undefined, { method: "GET" }).catch(() => {});
    };
    window.addEventListener(HORIZON_REFRESH_PULSE, fn);
    return () => window.removeEventListener(HORIZON_REFRESH_PULSE, fn);
  }, [reset, start]);

  const pulseRaw = useMemo(() => tryParseJson<Pulse>(narrative), [narrative]);
  const pulse = useMemo((): Pulse | null => {
    if (!pulseRaw) return null;
    if (!pulseRaw.kpis?.length) return pulseRaw;
    return { ...pulseRaw, kpis: applyPulseHygieneToKpis(pulseRaw.kpis) };
  }, [pulseRaw]);
  const isLoading = state === "streaming" && !pulse;
  const spokenText = useMemo(() => (pulse ? pulseToSpoken(pulse) : ""), [
    pulse,
  ]);

  function toggleVoice() {
    if (speaking) stop();
    else play(spokenText);
  }

  return (
    <div data-horizon-section="pulse">
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent-warm/80",
              isLoading && "animate-glow-pulse"
            )}
          />
          Portfolio pulse
        </h2>
        {voiceSupported && pulse && spokenText && (
          <button
            onClick={toggleVoice}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border/60 px-3 py-1 text-[10px] uppercase tracking-[0.14em] transition duration-med",
              speaking
                ? "border-accent/60 bg-accent text-bg shadow-glow"
                : "bg-surface/70 text-text-muted hover:border-accent/40 hover:text-text"
            )}
            aria-label={speaking ? "Stop narration" : "Play narration"}
          >
            {speaking ? <Square size={11} /> : <Play size={11} />}
            {speaking ? "Stop" : "Listen"}
            <Volume2 size={11} className="opacity-70" />
          </button>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
          {error}
        </div>
      )}

      {pulse?.kpis && pulse.kpis.length > 0 && (
        <div className="mt-4">
          <GhostPrompt
            text="Which KPI moved the most vs last week — and why?"
            context="The banker is viewing portfolio pulse KPIs."
          />
        </div>
      )}

      {isLoading && (
        <div className="mt-6 space-y-4">
          <div className="h-5 w-[85%] rounded shimmer" />
          <div className="h-5 w-[60%] rounded shimmer" />
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="h-[120px] rounded-xl shimmer" />
            <div className="h-[120px] rounded-xl shimmer" />
            <div className="h-[120px] rounded-xl shimmer" />
          </div>
        </div>
      )}

      {pulse?.narrative && (
        <p className="mt-6 max-w-[640px] text-[16px] leading-relaxed text-text text-balance">
          {pulse.narrative}
        </p>
      )}

      {pulse?.kpis && pulse.kpis.length > 0 && (
        <div className="mt-7 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible">
          {pulse.kpis.map((k, i) => (
            <KpiCard key={i} kpi={k} index={i} />
          ))}
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-7">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}

// KPI card — layered: base surface, subtle card-sheen gradient, direction-
// aware glow on the top edge. Up = emerald glow, down = red glow, flat =
// quiet. The number takes the stage at 32px.
function KpiCard({
  kpi,
  index,
}: {
  kpi: Pulse["kpis"][number];
  index: number;
}) {
  const dir = kpi.direction;
  const stagger =
    index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3";

  const directionTint =
    dir === "up"
      ? "from-emerald-400/25"
      : dir === "down"
      ? "from-red-400/25"
      : "from-accent/20";
  const deltaClass =
    dir === "up"
      ? "text-emerald-300"
      : dir === "down"
      ? "text-red-300"
      : "text-text-muted";

  return (
    <div
      className={cn(
        "group relative w-[min(88vw,280px)] shrink-0 snap-center animate-fade-rise overflow-hidden rounded-xl border border-border-soft bg-surface p-5 sm:w-auto sm:shrink",
        stagger
      )}
    >
      {/* Direction-aware top glow — thin gradient bleed at the top edge. */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b to-transparent",
          directionTint
        )}
        aria-hidden
      />

      {/* Card sheen overlay */}
      <div
        className="pointer-events-none absolute inset-0 bg-card-sheen opacity-60"
        aria-hidden
      />

      <div className="relative">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-text-muted">
            {kpi.label}
          </div>
          <DirectionBadge direction={dir} />
        </div>

        <div className="mt-3 font-display text-[30px] font-medium leading-none tracking-tight text-text md:text-[34px]">
          {kpi.value}
        </div>

        {kpi.delta !== "—" && (
          <div
            className={cn(
              "mt-2 flex items-center gap-1.5 font-mono text-[11px]",
              deltaClass
            )}
          >
            {kpi.delta}
          </div>
        )}

        {kpi.explanation && (
          <div className="mt-3 text-[12px] leading-snug text-text-muted">
            {kpi.explanation}
          </div>
        )}

        {/* A-3 — KPI tiles become actionable. Two tight buttons at the foot
            of each card: "Explain" routes through AskBar to investigate
            what drove the change; "Who drove this?" narrows to the top
            contributing clients or opportunities. Both keep the tile
            tappable without leaving the surface. */}
        <div className="mt-4 flex items-center gap-1.5 border-t border-border-soft/40 pt-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void dispatchAction({
                kind: "investigate",
                label: "Explain",
                question: `What drove the ${kpi.direction === "flat" ? "steady" : kpi.direction === "up" ? "increase" : "decrease"} in ${kpi.label} (${kpi.value}, ${kpi.delta})? Pull the supporting data from tableau_next and data_360.`,
                context: `KPI: ${kpi.label} = ${kpi.value} (${kpi.delta})`,
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface2 hover:text-text"
          >
            Explain
          </button>
          <span className="text-text-muted/40">·</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void dispatchAction({
                kind: "investigate",
                label: "Who drove this?",
                question: `Which three clients contributed the most to the ${kpi.delta} move in ${kpi.label}? Rank by absolute impact.`,
                context: `KPI: ${kpi.label}`,
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-text-muted transition hover:bg-surface2 hover:text-text"
          >
            Who drove this?
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: Pulse["kpis"][number]["direction"] }) {
  if (direction === "up") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
        <ArrowUpRight size={12} strokeWidth={2.4} />
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-400/15 text-red-300">
        <ArrowDownRight size={12} strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface2 text-text-muted">
      <Minus size={12} strokeWidth={2.4} />
    </span>
  );
}

function pulseToSpoken(p: Pulse): string {
  const lines: string[] = [];
  if (p.narrative) lines.push(p.narrative.trim());
  (p.kpis ?? []).forEach((k) => {
    const dir =
      k.direction === "up"
        ? "up"
        : k.direction === "down"
        ? "down"
        : "unchanged";
    lines.push(
      [`${k.label}: ${k.value}, ${dir} ${k.delta}.`, k.explanation?.trim()]
        .filter(Boolean)
        .join(" ")
    );
  });
  return lines.join(" ");
}
