"use client";

import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import {
  sectionInsightBatchSections,
  type InsightPayload,
  type SectionKind,
} from "@/lib/prompts/section-insight";
import { sanitizeBankerFacingPulseCopy } from "@/lib/client/pulseCopySanitize";
import { sanitizeProseLite } from "@/lib/safety/sanitize";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";

function sanitizeInsightLine(s: string): string {
  return sanitizeBankerFacingPulseCopy(sanitizeProseLite(s));
}

function parseSlice(v: unknown): InsightPayload | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.headline !== "string") return null;
  return {
    tone:
      o.tone === "attention" || o.tone === "urgent" ? o.tone : "calm",
    headline: sanitizeInsightLine(o.headline),
    action_hint:
      typeof o.action_hint === "string"
        ? sanitizeInsightLine(o.action_hint)
        : null,
  };
}

function parseBatch(narrative: string): Partial<Record<SectionKind, InsightPayload>> {
  const raw = tryParseJson<Record<string, unknown>>(narrative);
  if (!raw) return {};
  const out: Partial<Record<SectionKind, InsightPayload>> = {};
  for (const key of sectionInsightBatchSections()) {
    const p = parseSlice(raw[key]);
    if (p) out[key] = p;
  }
  return out;
}

export type InsightsBatchContextValue = {
  payloads: Partial<Record<SectionKind, InsightPayload>>;
  state: "idle" | "streaming" | "done" | "error";
  error: string | null;
};

const InsightsBatchContext = createContext<InsightsBatchContextValue | null>(
  null
);

export function InsightsBatchProvider({ children }: { children: ReactNode }) {
  const { narrative, state, error, start } = useAgentStream();

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      void start("/api/insights", {
        sections: [...sectionInsightBatchSections()],
      });
    }, AGENT_STAGGER_MS.insightsBatch);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [start]);

  const payloads = useMemo(
    () => parseBatch(narrative),
    [narrative]
  );

  const value = useMemo(
    (): InsightsBatchContextValue => ({
      payloads,
      state,
      error,
    }),
    [payloads, state, error]
  );

  return (
    <InsightsBatchContext.Provider value={value}>
      {children}
    </InsightsBatchContext.Provider>
  );
}

export function useInsightsBatch(): InsightsBatchContextValue | null {
  return useContext(InsightsBatchContext);
}
