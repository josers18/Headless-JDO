"use client";

import { useEffect, useMemo } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { ReasoningTrail } from "./ReasoningTrail";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { tryParseJson } from "@/lib/client/jsonStream";
import type { MorningBrief as Brief } from "@/types/horizon";
import { cn } from "@/lib/utils";

// MorningBrief owns the top of the page. The hero treatment matters more
// here than anywhere else — this is the first thing the banker sees. The
// greeting is rendered with a subtle gradient sheen on the name portion,
// and the numbered items cascade in via the staggered fade-rise utility
// defined in globals.css so the dashboard feels composed rather than
// suddenly-here.
export function MorningBrief() {
  const { narrative, steps, state, error, start } = useAgentStream();
  const { supported: voiceSupported, speaking, play, stop } =
    useSpokenNarration();

  useEffect(() => {
    void start("/api/brief", {});
  }, [start]);

  const brief = useMemo(() => tryParseJson<Brief>(narrative), [narrative]);
  const isLoading = state === "streaming" && !brief;
  const isComplete = Boolean(brief) && state !== "error";

  const spokenText = useMemo(
    () => (brief ? briefToSpokenText(brief) : ""),
    [brief]
  );

  function toggleVoice() {
    if (speaking) stop();
    else play(spokenText);
  }

  const greeting = brief?.greeting ?? "";
  const { lead, rest } = splitGreeting(greeting);

  return (
    <div className="relative">
      {/* Ambient glow anchored to the hero — adds depth without stealing
          attention from the content. Fades to transparent at the bottom. */}
      <div
        className="pointer-events-none absolute -inset-x-8 -top-24 h-[280px] bg-hero-glow drift"
        aria-hidden
      />

      <div className="relative flex items-center justify-between">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent",
              state === "streaming" && "animate-glow-pulse"
            )}
          />
          Today
        </div>
        {voiceSupported && isComplete && spokenText && (
          <button
            onClick={toggleVoice}
            className={cn(
              "group relative flex items-center gap-2 overflow-hidden rounded-full border border-border/60 px-3.5 py-1.5 text-[11px] uppercase tracking-[0.14em] transition duration-med",
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

      <div className="relative mt-6 font-display text-[42px] leading-[1.04] tracking-tight text-text text-balance md:text-[56px]">
        {greeting ? (
          <>
            <span className="text-sheen">{lead}</span>
            {rest && (
              <span className="text-accent-sheen">{rest}</span>
            )}
            {state === "streaming" && (
              <span className="ml-1 inline-block h-[0.9em] w-[3px] translate-y-[6px] animate-pulse bg-accent" />
            )}
          </>
        ) : isLoading ? (
          <div className="flex flex-col gap-3">
            <span className="inline-block h-[0.9em] w-[70%] max-w-[480px] rounded-md shimmer" />
            <span className="inline-block h-[0.9em] w-[45%] max-w-[320px] rounded-md shimmer" />
          </div>
        ) : error ? (
          <span className="text-[28px] text-text-muted md:text-[32px]">{error}</span>
        ) : (
          "Ready."
        )}
      </div>

      {brief?.items && brief.items.length > 0 && (
        <ol className="relative mt-12 space-y-7">
          {brief.items.map((item, idx) => (
            <li
              key={`${idx}-${item.headline}`}
              className={cn(
                "animate-fade-rise grid grid-cols-[48px_1fr] gap-5",
                idx === 0 && "stagger-1",
                idx === 1 && "stagger-2",
                idx === 2 && "stagger-3",
                idx > 2 && "stagger-4"
              )}
            >
              <div className="pt-1">
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border-soft bg-surface font-mono text-[11px] tabular-nums text-text-muted">
                  {String(idx + 1).padStart(2, "0")}
                </div>
              </div>
              <div>
                <div className="text-[18px] font-medium leading-snug text-text text-balance md:text-[19px]">
                  {item.headline}
                </div>
                <p className="mt-2 max-w-[640px] text-[14px] leading-relaxed text-text-muted">
                  {item.why}
                </p>
                {item.suggested_action && (
                  <div className="mt-3.5 flex items-start gap-3 text-[13px] text-text">
                    <span
                      className="mt-[10px] h-[2px] w-[18px] shrink-0 bg-accent/70"
                      aria-hidden
                    />
                    <span className="text-accent/95">
                      {item.suggested_action}
                    </span>
                  </div>
                )}
                {item.sources && item.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
                    {item.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border-soft px-1.5 py-0.5"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {brief?.signoff && (
        <div className="relative mt-12 max-w-prose text-[13px] italic leading-relaxed text-text-muted">
          {brief.signoff}
        </div>
      )}

      {!brief && state === "streaming" && (
        <div className="relative mt-10 space-y-4">
          <div className="h-5 w-[85%] rounded shimmer" />
          <div className="h-5 w-[72%] rounded shimmer" />
          <div className="h-5 w-[60%] rounded shimmer" />
        </div>
      )}

      {steps.length > 0 && (
        <div className="relative mt-10">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}

// Split the greeting so we can emphasize the name portion with a different
// text treatment. The brief always returns something like
// "Good morning, Jose." — we keep the salutation in muted-sheen and put
// the accent-sheen on the comma-delimited name so the hero has a clear
// visual focal point.
function splitGreeting(greeting: string): { lead: string; rest: string } {
  if (!greeting) return { lead: "", rest: "" };
  const idx = greeting.indexOf(",");
  if (idx === -1 || idx >= greeting.length - 1) {
    return { lead: greeting, rest: "" };
  }
  return {
    lead: greeting.slice(0, idx + 1) + " ",
    rest: greeting.slice(idx + 1).trim(),
  };
}

// Morning-brief voice script. Kept procedural + compact on purpose so the
// banker can scan the page while the narration plays in the background.
function briefToSpokenText(brief: Brief): string {
  const intro = brief.greeting?.trim() ?? "";
  const ordinals = ["First", "Second", "Third", "Fourth", "Fifth"];
  const bodyLines = (brief.items ?? []).map((item, i) => {
    const lead = ordinals[i] ?? `Item ${i + 1}`;
    const parts = [item.headline, item.why, item.suggested_action]
      .filter(Boolean)
      .map((s) => s.trim());
    return `${lead}: ${parts.join(" ")}`;
  });
  const outro = brief.signoff?.trim() ?? "";
  return [intro, ...bodyLines, outro].filter(Boolean).join(" ");
}
