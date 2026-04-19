"use client";

import { useEffect, useMemo } from "react";
import { Play, Square, Volume2 } from "lucide-react";
import { ReasoningTrail } from "./ReasoningTrail";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { tryParseJson } from "@/lib/client/jsonStream";
import type { MorningBrief as Brief } from "@/types/horizon";
import { cn } from "@/lib/utils";

// MorningBrief owns the top of the page. The API returns JSON the moment
// the model is satisfied; while the stream is in flight we progressively
// parse a partial brief and render whatever is already well-formed. When
// the brief is fully parsed, we offer Web Speech narration — voice is the
// "lean forward" moment called out in CLAUDE.md §14.
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

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Today
        </div>
        {voiceSupported && isComplete && spokenText && (
          <button
            onClick={toggleVoice}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] transition duration-fast",
              speaking
                ? "bg-accent text-bg"
                : "bg-surface2/60 text-text-muted hover:text-text"
            )}
            aria-label={speaking ? "Stop narration" : "Play narration"}
          >
            {speaking ? <Square size={12} /> : <Play size={12} />}
            {speaking ? "Stop" : "Listen"}
            <Volume2 size={12} className="opacity-70" />
          </button>
        )}
      </div>

      <div className="mt-4 font-display text-[34px] leading-[1.15] tracking-tight text-text text-balance md:text-[44px]">
        {brief?.greeting ? (
          <>
            {brief.greeting}
            {state === "streaming" && (
              <span className="ml-1 inline-block h-[1em] w-[3px] translate-y-[4px] animate-pulse bg-accent" />
            )}
          </>
        ) : isLoading ? (
          <span className="inline-block h-[1em] w-[70%] max-w-[520px] rounded shimmer" />
        ) : error ? (
          <span className="text-text-muted">{error}</span>
        ) : (
          "Ready."
        )}
      </div>

      {brief?.items && brief.items.length > 0 && (
        <ol className="mt-10 space-y-6">
          {brief.items.map((item, idx) => (
            <li
              key={`${idx}-${item.headline}`}
              className="animate-fade-rise grid grid-cols-[auto_1fr] gap-5"
            >
              <div className="pt-1 font-mono text-[11px] text-text-muted/70">
                {String(idx + 1).padStart(2, "0")}
              </div>
              <div>
                <div className="text-[17px] font-medium leading-snug text-text text-balance">
                  {item.headline}
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-text-muted">
                  {item.why}
                </p>
                {item.suggested_action && (
                  <div className="mt-3 flex items-start gap-2 text-[13px] text-accent/90">
                    <span className="mt-[7px] h-[3px] w-[12px] shrink-0 bg-accent/60" />
                    <span>{item.suggested_action}</span>
                  </div>
                )}
                {item.sources && item.sources.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
                    {item.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border/50 px-1.5 py-0.5"
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
        <div className="mt-10 text-[13px] italic text-text-muted">
          {brief.signoff}
        </div>
      )}

      {!brief && state === "streaming" && (
        <div className="mt-8 space-y-4">
          <div className="h-5 w-[85%] rounded shimmer" />
          <div className="h-5 w-[72%] rounded shimmer" />
          <div className="h-5 w-[60%] rounded shimmer" />
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-8">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
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
