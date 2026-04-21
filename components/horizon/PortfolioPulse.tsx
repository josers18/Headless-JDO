"use client";

import { useEffect, useMemo, useState } from "react";
import { HORIZON_REFRESH_PULSE } from "@/lib/client/horizonEvents";
import { Play, Square, Volume2 } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { applyPulseHygieneToKpis } from "@/lib/client/pulseMetricHygiene";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { GhostPrompt } from "./GhostPrompt";
import { cn } from "@/lib/utils";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";
import { sanitizeBankerFacingPulseCopy } from "@/lib/client/pulseCopySanitize";
import { PulseTile } from "./PulseTile";

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
  const [awaitingKickoff, setAwaitingKickoff] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setAwaitingKickoff(false);
      void start("/api/pulse", undefined, { method: "GET" }).catch(() => {});
    }, AGENT_STAGGER_MS.portfolioPulse);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [start]);

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
  const isLoading =
    (state === "streaming" || (state === "idle" && awaitingKickoff)) && !pulse;
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
          {sanitizeBankerFacingPulseCopy(error)}
        </div>
      )}

      {pulse?.kpis && pulse.kpis.length > 0 && (
        <div className="mt-4">
          <GhostPrompt
            text="Treasury moved overnight — want talk tracks that fit today's client calls?"
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
          {sanitizeBankerFacingPulseCopy(pulse.narrative)}
        </p>
      )}

      {pulse?.kpis && pulse.kpis.length > 0 && (
        <div className="mt-7 flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] sm:grid sm:snap-none sm:grid-cols-3 sm:overflow-visible">
          {pulse.kpis.map((k, i) => (
            <PulseTile key={i} kpi={k} index={i} />
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

function pulseToSpoken(p: Pulse): string {
  const lines: string[] = [];
  if (p.narrative) lines.push(sanitizeBankerFacingPulseCopy(p.narrative.trim()));
  (p.kpis ?? []).forEach((k) => {
    const dir =
      k.direction === "up"
        ? "up"
        : k.direction === "down"
        ? "down"
        : "unchanged";
    const deltaT = sanitizeBankerFacingPulseCopy(k.delta);
    const explT = k.explanation?.trim()
      ? sanitizeBankerFacingPulseCopy(k.explanation.trim())
      : "";
    lines.push([`${k.label}: ${k.value}, ${dir} ${deltaT}.`, explT].filter(Boolean).join(" "));
  });
  return lines.join(" ");
}
