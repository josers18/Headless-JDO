"use client";

import { useEffect, useMemo, useState } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { tryParseJson } from "@/lib/client/jsonStream";
import { ReasoningTrail } from "./ReasoningTrail";
import { cn } from "@/lib/utils";

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
  const { narrative, steps, state, error, start } = useAgentStream();
  const { supported: voiceSupported, speaking, play, stop } =
    useSpokenNarration();
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    start("/api/pulse", undefined, { method: "GET" }).catch(() => {});
  }, [hasStarted, start]);

  const pulse = useMemo(() => tryParseJson<Pulse>(narrative), [narrative]);
  const isLoading = state === "streaming" && !pulse;
  const spokenText = useMemo(() => (pulse ? pulseToSpoken(pulse) : ""), [
    pulse,
  ]);

  function toggleVoice() {
    if (speaking) stop();
    else play(spokenText);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Portfolio pulse
        </h2>
        {voiceSupported && pulse && spokenText && (
          <button
            onClick={toggleVoice}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border/60 px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] transition duration-fast",
              speaking
                ? "bg-accent text-bg"
                : "bg-surface2/60 text-text-muted hover:text-text"
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
        <div className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="mt-5 space-y-3">
          <div className="h-5 w-[85%] rounded shimmer" />
          <div className="h-5 w-[60%] rounded shimmer" />
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="h-20 rounded-lg shimmer" />
            <div className="h-20 rounded-lg shimmer" />
            <div className="h-20 rounded-lg shimmer" />
          </div>
        </div>
      )}

      {pulse?.narrative && (
        <p className="mt-5 max-w-prose text-[15px] leading-relaxed text-text">
          {pulse.narrative}
        </p>
      )}

      {pulse?.kpis && pulse.kpis.length > 0 && (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {pulse.kpis.map((k, i) => (
            <div
              key={i}
              className="animate-fade-rise rounded-lg border border-border/60 bg-surface2/40 px-4 py-3"
            >
              <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {k.label}
              </div>
              <div className="mt-1 text-[22px] font-medium leading-tight text-text">
                {k.value}
              </div>
              <div
                className={cn(
                  "mt-0.5 font-mono text-[11px]",
                  k.direction === "up"
                    ? "text-emerald-300"
                    : k.direction === "down"
                    ? "text-red-300"
                    : "text-text-muted"
                )}
              >
                {k.direction === "up" ? "▲" : k.direction === "down" ? "▼" : "—"}{" "}
                {k.delta}
              </div>
              {k.explanation && (
                <div className="mt-2 text-[12px] leading-snug text-text-muted">
                  {k.explanation}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
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
