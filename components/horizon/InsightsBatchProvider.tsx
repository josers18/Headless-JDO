"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import {
  sectionInsightBatchSections,
  type InsightPayload,
  type SectionKind,
} from "@/lib/prompts/section-insight";
import { sanitizeProseLite } from "@/lib/safety/sanitize";

function parseSlice(v: unknown): InsightPayload | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.headline !== "string") return null;
  return {
    tone:
      o.tone === "attention" || o.tone === "urgent" ? o.tone : "calm",
    headline: sanitizeProseLite(o.headline),
    action_hint:
      typeof o.action_hint === "string"
        ? sanitizeProseLite(o.action_hint)
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
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start("/api/insights", {
      sections: [...sectionInsightBatchSections()],
    });
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
