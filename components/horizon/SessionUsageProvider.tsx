"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

export interface SessionUsageSummary {
  models: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }>;
  totals: { inputTokens: number; outputTokens: number; exact: boolean };
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

  const bumpLive = useCallback(
    (u: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
    }) => {
      setData((prev) => {
        const base: SessionUsageSummary = prev ?? {
          models: [],
          totals: { inputTokens: 0, outputTokens: 0, exact: true },
        };
        const models = base.models.map((m) => ({ ...m }));
        const existing = models.find((m) => m.model === u.model);
        if (existing) {
          existing.inputTokens += u.inputTokens;
          existing.outputTokens += u.outputTokens;
          existing.exact = existing.exact && u.exact;
        } else {
          models.push({
            model: u.model,
            inputTokens: u.inputTokens,
            outputTokens: u.outputTokens,
            exact: u.exact,
          });
        }
        return {
          models,
          totals: {
            inputTokens: base.totals.inputTokens + u.inputTokens,
            outputTokens: base.totals.outputTokens + u.outputTokens,
            exact: base.totals.exact && u.exact,
          },
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
