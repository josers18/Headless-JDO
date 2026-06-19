"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { estimateCostUsd } from "@/lib/llm/modelPricing";

// Mirrors lib/db/tokenUsage.ts#SessionUsageSummary. Redeclared client-side
// (not imported) so this client component pulls in no server-only code.
export interface SessionUsageModel {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  exact: boolean;
  costUsd: number;
}

export interface SessionUsageLastTurn {
  model: string;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  durationMs: number;
}

export interface SessionUsageSummary {
  models: SessionUsageModel[];
  totals: {
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
    costUsd: number;
  };
  turns: number;
  toolCalls: number;
  lastTurn: SessionUsageLastTurn | null;
}

interface SessionUsageCtx {
  data: SessionUsageSummary | null;
  loading: boolean;
  refresh: () => void;
  bumpLive: (u: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }) => void;
}

const EMPTY: SessionUsageSummary = {
  models: [],
  totals: { inputTokens: 0, outputTokens: 0, exact: true, costUsd: 0 },
  turns: 0,
  toolCalls: 0,
  lastTurn: null,
};

const Ctx = createContext<SessionUsageCtx | null>(null);

export function SessionUsageProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<SessionUsageSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    fetch("/api/usage", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: SessionUsageSummary | null) => {
        if (j && Array.isArray(j.models)) setData(j);
      })
      .catch(() => {
        /* keep last good data */
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, []);

  // Optimistic merge of one run's token usage. The live usage_meta event only
  // carries tokens (not tool_calls / duration), so we bump tokens + cost +
  // turn count immediately; the DB refresh() that follows fills in the
  // tool-call totals and last-turn latency.
  const bumpLive = useCallback(
    (u: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
    }) => {
      setData((prev) => {
        const base = prev ?? EMPTY;
        const models = base.models.map((m) => ({ ...m }));
        const runCost = estimateCostUsd(u.model, u.inputTokens, u.outputTokens);
        const existing = models.find((m) => m.model === u.model);
        if (existing) {
          existing.inputTokens += u.inputTokens;
          existing.outputTokens += u.outputTokens;
          existing.exact = existing.exact && u.exact;
          existing.costUsd += runCost;
        } else {
          models.push({
            model: u.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            toolCalls: 0,
            exact: u.exact,
            costUsd: runCost,
          });
        }
        return {
          models,
          totals: {
            inputTokens: base.totals.inputTokens + u.inputTokens,
            outputTokens: base.totals.outputTokens + u.outputTokens,
            exact: base.totals.exact && u.exact,
            costUsd: base.totals.costUsd + runCost,
          },
          turns: base.turns + 1,
          toolCalls: base.toolCalls,
          lastTurn: base.lastTurn,
        };
      });
    },
    []
  );

  // Initial load + refresh when the tab regains focus (background section
  // runs may have written rows while the user was away).
  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  return (
    <Ctx.Provider value={{ data, loading, refresh, bumpLive }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSessionUsage(): SessionUsageCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Safe no-op fallback so the panel can be rendered outside the
    // provider during incremental wiring without throwing.
    return {
      data: null,
      loading: false,
      refresh: () => {},
      bumpLive: () => {},
    };
  }
  return ctx;
}
