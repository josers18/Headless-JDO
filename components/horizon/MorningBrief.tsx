"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HORIZON_REFRESH_BRIEF } from "@/lib/client/horizonEvents";
import { dispatchHorizonFocusClient } from "@/lib/client/horizonEvents";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  Volume2,
} from "lucide-react";
import { ReasoningTrail } from "./ReasoningTrail";
import { BriefRichText } from "./BriefRichText";
import { ClientDetailSheet } from "./ClientDetailSheet";
import { GhostPrompt } from "./GhostPrompt";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpokenNarration } from "@/lib/client/useSpokenNarration";
import { tryParseJson } from "@/lib/client/jsonStream";
import {
  briefItemKey,
  readRightNowSnooze,
  writeRightNowSnooze,
} from "@/lib/client/rightNowSnooze";
import { resolveRightNowCta } from "@/lib/client/rightNowCta";
import { rightNowGhostAskContext } from "@/lib/prompts/right-now-ghost";
import type { BriefItem, MorningBrief as Brief } from "@/types/horizon";
import { cn } from "@/lib/utils";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";

function normalizeBrief(raw: Brief | null): Brief | null {
  if (!raw || !raw.items?.length) return raw;
  let idx: number | undefined = raw.right_now_index;
  if (typeof idx === "string") {
    idx = Number.parseInt(idx, 10);
  }
  if (idx !== 0 && idx !== 1 && idx !== 2) idx = 0;
  if (!raw.items[idx]) idx = 0;
  return { ...raw, right_now_index: idx as 0 | 1 | 2 };
}

function resolveHeroIndex(brief: Brief): number {
  const preferred = brief.right_now_index ?? 0;
  const snooze = readRightNowSnooze();
  const order = [preferred, 0, 1, 2].filter((v, i, a) => a.indexOf(v) === i);
  for (const i of order) {
    const item = brief.items[i];
    if (!item) continue;
    const key = briefItemKey(item);
    if (snooze && snooze.itemKey === key && Date.now() < snooze.until) {
      continue;
    }
    return i;
  }
  return preferred;
}

export function MorningBrief() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const { supported: voiceSupported, speaking, play, stop } =
    useSpokenNarration();
  const [snoozeTick, setSnoozeTick] = useState(0);
  const [sheet, setSheet] = useState<{
    clientId: string;
    name?: string;
  } | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      void start("/api/brief", {});
    }, AGENT_STAGGER_MS.brief);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [start]);

  useEffect(() => {
    const fn = () => {
      reset();
      void start("/api/brief", {});
    };
    window.addEventListener(HORIZON_REFRESH_BRIEF, fn);
    return () => window.removeEventListener(HORIZON_REFRESH_BRIEF, fn);
  }, [reset, start]);

  const brief = useMemo(
    () => normalizeBrief(tryParseJson<Brief>(narrative)),
    [narrative]
  );
  const isLoading = state === "streaming" && !brief;
  const isComplete = Boolean(brief) && state !== "error";

  const heroIndex = useMemo(() => {
    void snoozeTick;
    return brief ? resolveHeroIndex(brief) : 0;
  }, [brief, snoozeTick]);

  const heroItem = brief?.items[heroIndex];

  const spokenText = useMemo(() => {
    const b = normalizeBrief(tryParseJson<Brief>(narrative));
    return b ? briefToSpokenText(b) : "";
  }, [narrative]);

  function toggleVoice() {
    if (speaking) stop();
    else play(spokenText);
  }

  const onSnooze = useCallback(() => {
    if (!heroItem) return;
    writeRightNowSnooze(briefItemKey(heroItem), 3_600_000);
    setWhyOpen(false);
    setSnoozeTick((n) => n + 1);
  }, [heroItem]);

  const greeting = brief?.greeting ?? "";
  const { lead, rest } = splitGreeting(greeting);
  const cta = heroItem ? resolveRightNowCta(heroItem) : null;

  return (
    <div className="relative" data-horizon-section="brief">
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
            {rest && <span className="text-accent-sheen">{rest}</span>}
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
          <span className="text-[28px] text-text-muted md:text-[32px]">
            {error}
          </span>
        ) : (
          "Ready."
        )}
      </div>

      {isComplete && heroItem && (
        <div className="relative mt-4">
          <GhostPrompt
            key={briefItemKey(heroItem)}
            text="Why is this Right Now item the right first move?"
            context={`The banker is viewing the morning brief.\n${rightNowGhostAskContext(heroItem)}`}
          />
        </div>
      )}

      {heroItem && cta && (
        <section
          className="relative mt-10 animate-fade-rise rounded-2xl border border-border-soft/80 bg-surface2/50 p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.55)] md:p-8"
          aria-labelledby="right-now-heading"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              id="right-now-heading"
              className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-muted"
            >
              Right now ·{" "}
              {new Date().toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })}
            </h2>
          </div>

          <h3 className="mt-4 max-w-[720px] text-[22px] font-semibold leading-snug tracking-tight text-text text-balance md:text-[30px]">
            <BriefRichText
              text={heroItem.headline}
              clientId={heroItem.client_id}
              clientName={heroItem.client_name}
              entityLinks={heroItem.entity_links}
              probeCoListedNames
            />
          </h3>
          <p className="mt-3 max-w-[640px] text-[15px] leading-relaxed text-text-muted md:text-[16px]">
            <BriefRichText
              text={heroItem.why}
              clientId={heroItem.client_id}
              clientName={heroItem.client_name}
              entityLinks={heroItem.entity_links}
              probeCoListedNames
            />
          </p>
          {heroItem.suggested_action && (
            <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-text/90">
              <BriefRichText
                text={heroItem.suggested_action}
                clientId={heroItem.client_id}
                clientName={heroItem.client_name}
                entityLinks={heroItem.entity_links}
                probeCoListedNames
              />
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                if (heroItem.client_id) {
                  const name =
                    heroItem.client_name?.trim() ||
                    extractNameHint(heroItem.headline);
                  dispatchHorizonFocusClient({
                    name: name ?? "Client",
                    clientId: heroItem.client_id,
                  });
                  setSheet({
                    clientId: heroItem.client_id,
                    name,
                  });
                  return;
                }
                document
                  .querySelector<HTMLInputElement>(
                    'input[aria-label="Ask Horizon"]'
                  )
                  ?.focus();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-accent-sheen px-4 py-2.5 text-[13px] font-medium text-bg shadow-glow transition hover:brightness-110"
              aria-label={`${cta.label} — primary action for this Right Now item`}
            >
              <cta.Icon className="size-4 shrink-0" aria-hidden />
              {cta.label}
            </button>
            <button
              type="button"
              disabled={!heroItem.client_id}
              onClick={() => {
                if (!heroItem.client_id) return;
                const name =
                  heroItem.client_name?.trim() ||
                  extractNameHint(heroItem.headline);
                dispatchHorizonFocusClient({
                  name: name ?? "Client",
                  clientId: heroItem.client_id,
                });
                setSheet({
                  clientId: heroItem.client_id,
                  name,
                });
              }}
              className={cn(
                "inline-flex items-center gap-2 rounded-xl border border-border-soft px-4 py-2.5 text-[13px] text-text transition",
                heroItem.client_id
                  ? "hover:border-accent/40 hover:bg-surface/80"
                  : "cursor-not-allowed opacity-40"
              )}
            >
              View context
              <ChevronRight size={14} className="opacity-60" />
            </button>
            <button
              type="button"
              onClick={onSnooze}
              className="inline-flex items-center gap-2 rounded-xl border border-border-soft px-4 py-2.5 text-[13px] text-text-muted transition hover:border-border hover:text-text"
            >
              Snooze 1hr
            </button>
          </div>

          <div className="mt-5 border-t border-border-soft/60 pt-4">
            <button
              type="button"
              onClick={() => setWhyOpen((o) => !o)}
              className="flex w-full items-center justify-between text-left text-[12px] font-medium uppercase tracking-[0.16em] text-text-muted transition hover:text-text"
              aria-expanded={whyOpen}
            >
              <span>Why this is top priority</span>
              <ChevronDown
                size={16}
                className={cn(
                  "shrink-0 opacity-60 transition-transform",
                  whyOpen && "rotate-180"
                )}
              />
            </button>
            {whyOpen && (
              <div className="mt-3 space-y-3 rounded-lg border border-border-soft/50 bg-black/20 px-4 py-3 text-[13px] leading-relaxed text-text-muted animate-fade-in">
                <p className="text-text/90">
                  <BriefRichText
                    text={heroItem.why}
                    clientId={heroItem.client_id}
                    clientName={heroItem.client_name}
                    entityLinks={heroItem.entity_links}
                    probeCoListedNames
                  />
                </p>
                {heroItem.sources && heroItem.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/80">
                    {heroItem.sources.map((s) => (
                      <span
                        key={s}
                        className="rounded border border-border-soft px-1.5 py-0.5"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-[12px] text-text-muted/80">
                  Full MCP trace for this brief is in the reasoning trail below.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      {/* B-1 — "Also today" items are collapsed into the Priority Queue
          below. Keeping both here created vertical redundancy (same
          backing data, two renderings). The Morning Brief now stays
          focused on the single Right-Now hero; everything else lives in
          the Priority Queue. */}

      {brief?.signoff && (
        <div className="relative mt-8 max-w-prose text-[13px] italic leading-relaxed text-text-muted">
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
        <div id="morning-brief-trail" className="relative mt-10">
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

function extractNameHint(headline: string): string | undefined {
  const m = headline.match(
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/
  );
  return m?.[1]?.trim();
}

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
