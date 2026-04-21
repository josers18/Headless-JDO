"use client";

import { useEffect, useMemo, useState } from "react";
import { Sparkles, AlertTriangle, Zap } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import type {
  InsightPayload,
  SectionKind,
} from "@/lib/prompts/section-insight";
import { useInsightsBatch } from "./InsightsBatchProvider";
import { cn } from "@/lib/utils";
import { sanitizeProseLite } from "@/lib/safety/sanitize";

/**
 * C-1 — SectionInsight banner. Sits above a major surface (Priority Queue,
 * Portfolio Pulse, Pre-drafted Actions, Live Signals) and renders the agent's
 * editorial "so what?" for that section. Reads as a hairline ticker with
 * one sentence + one optional action hint.
 *
 * Streams from `/api/insights`, parses the final JSON once streaming is done.
 */

function parseInsight(raw: string): InsightPayload | null {
  if (!raw) return null;
  // Strip code fences if the model adds them despite the prompt.
  const clean = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    const obj = JSON.parse(clean) as InsightPayload;
    if (!obj || typeof obj.headline !== "string") return null;
    return {
      tone: obj.tone ?? "calm",
      headline: sanitizeProseLite(obj.headline),
      action_hint: obj.action_hint ? sanitizeProseLite(obj.action_hint) : null,
    };
  } catch {
    return null;
  }
}

const TONE: Record<
  InsightPayload["tone"],
  {
    icon: typeof Sparkles;
    accent: string;
    dot: string;
  }
> = {
  calm: {
    icon: Sparkles,
    accent: "text-text-muted",
    dot: "bg-text-muted/60",
  },
  attention: {
    icon: Zap,
    accent: "text-amber-300/90",
    dot: "bg-amber-300/70",
  },
  urgent: {
    icon: AlertTriangle,
    accent: "text-rose-300/95",
    dot: "bg-rose-300/80",
  },
};

export function SectionInsight({
  section,
  label,
  className,
}: {
  section: SectionKind;
  label: string;
  className?: string;
}) {
  const batch = useInsightsBatch();
  const legacy = useAgentStream();
  const [legacyPayload, setLegacyPayload] = useState<InsightPayload | null>(
    null
  );

  useEffect(() => {
    if (batch) return;
    void legacy.start("/api/insights", { section });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, batch]);

  useEffect(() => {
    if (batch) return;
    if (legacy.state !== "done") return;
    const parsed = parseInsight(legacy.narrative);
    if (parsed) setLegacyPayload(parsed);
  }, [batch, legacy.state, legacy.narrative]);

  const payload = batch?.payloads[section] ?? legacyPayload;
  const state = batch?.state ?? legacy.state;
  const streaming =
    state === "streaming" &&
    !(batch?.payloads[section] ?? legacyPayload);

  const style = useMemo(() => TONE[payload?.tone ?? "calm"], [payload]);
  const Icon = style.icon;

  if (state === "error") return null;

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border-soft/40 bg-surface/20 px-4 py-2.5 text-[12px] leading-snug",
        className
      )}
      role="note"
      aria-label={`${label} insight`}
    >
      <span
        className={cn(
          "mt-[3px] inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
          style.dot,
          streaming && "animate-pulse"
        )}
        aria-hidden
      />
      <Icon
        size={13}
        className={cn("mt-[2px] shrink-0", style.accent)}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {payload ? (
          <p className={cn("text-text", style.accent)}>
            <span className="text-text">{payload.headline}</span>
            {payload.action_hint && (
              <>
                {" "}
                <span className="text-text-muted">— {payload.action_hint}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-text-muted/70">
            {streaming
              ? `Reading the ${label.toLowerCase()}…`
              : `Gathering context for ${label.toLowerCase()}…`}
          </p>
        )}
      </div>
    </div>
  );
}
