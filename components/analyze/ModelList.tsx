"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SemanticModelSummary } from "@/lib/analyze/types";

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; models: SemanticModelSummary[] }
  | { kind: "error"; message: string }
  | { kind: "unauth" };

export function ModelList() {
  const params = useParams();
  const activeId =
    typeof params?.modelId === "string" ? params.modelId : null;

  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/analyze-models", { cache: "no-store" });
      if (res.status === 401) {
        setState({ kind: "unauth" });
        return;
      }
      if (!res.ok) {
        setState({
          kind: "error",
          message: `Models unavailable (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as { models: SemanticModelSummary[] };
      setState({ kind: "ready", models: data.models ?? [] });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Load failed",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (state.kind !== "ready") return [];
    const q = query.trim().toLowerCase();
    if (!q) return state.models;
    return state.models.filter((m) => {
      const hay = `${m.label} ${m.apiName} ${m.description ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [state, query]);

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pb-8">
      <div className="px-2 pt-1">
        <label className="flex items-center gap-2 rounded-lg border border-border-soft bg-surface/60 px-3 py-2 text-[13px] text-text-muted focus-within:border-accent/60 focus-within:text-text">
          <Search size={13} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models"
            className="w-full bg-transparent text-[13px] text-text placeholder:text-text-muted focus:outline-none"
            aria-label="Search semantic models"
          />
        </label>
      </div>

      {state.kind === "loading" && (
        <div className="px-4 text-[12px] text-text-muted">Loading models…</div>
      )}

      {state.kind === "unauth" && (
        <div className="px-4 text-[12px] text-text-muted">
          Sign in to see available semantic models.
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex flex-col items-start gap-2 px-4">
          <p className="text-[12px] text-danger/90">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-md border border-border-soft px-2 py-1 text-[11px] text-text-muted transition hover:border-accent/50 hover:text-text"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}

      {state.kind === "ready" && state.models.length === 0 && (
        <div className="px-4 text-[12px] text-text-muted">
          No semantic models available in this org.
        </div>
      )}

      {state.kind === "ready" && state.models.length > 0 && (
        <>
          <div className="px-4 pb-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
            {filtered.length === state.models.length
              ? `${state.models.length} models`
              : `${filtered.length} of ${state.models.length}`}
          </div>
          <ul className="flex flex-col">
            {filtered.map((m) => {
              const active = m.id === activeId;
              return (
                <li key={m.id}>
                  {/* Hard-navigate for consistency with the rail — each
                      model selection is a URL change, which we want to
                      feel instant even if an analyze turn is running. */}
                  <a
                    href={`/analyze/${m.id}`}
                    className={cn(
                      "flex flex-col gap-0.5 px-4 py-2.5 text-left transition",
                      active
                        ? "border-l-2 border-accent bg-surface-raised"
                        : "border-l-2 border-transparent hover:bg-surface-raised/60"
                    )}
                    aria-current={active ? "page" : undefined}
                  >
                    <span
                      className={cn(
                        "truncate text-[13px]",
                        active ? "text-text" : "text-text-muted"
                      )}
                      title={m.label}
                    >
                      {m.label}
                    </span>
                    {m.description && (
                      <span className="truncate text-[11px] text-text-muted/80">
                        {m.description}
                      </span>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
