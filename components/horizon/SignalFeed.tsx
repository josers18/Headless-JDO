"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { tryParseJson } from "@/lib/client/jsonStream";
import type { Signal } from "@/types/horizon";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 45_000;

// SignalFeed polls /api/signals on a 45s cadence. data_360 doesn't push
// events, so "live" is "recently observed." We merge new signals into the
// existing list by id so cards don't flicker; new ones fade in via the
// `animate-fade-rise` utility.
export function SignalFeed() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/signals", { signal: ctrl.signal });
      const json = (await res.json().catch(() => null)) as {
        result?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? `Request failed (${res.status})`);
        return;
      }
      const parsed = tryParseJson<{ signals?: Signal[] }>(json?.result ?? "");
      const incoming = Array.isArray(parsed?.signals) ? parsed!.signals! : [];
      setSignals((prev) => mergeSignals(prev, incoming));
      setLastUpdated(new Date());
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();
    const t = window.setInterval(() => {
      void fetchOnce();
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(t);
      abortRef.current?.abort();
    };
  }, [fetchOnce]);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Live signals
        </h2>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="font-mono text-[10px] text-text-muted/70">
              updated {relativeTime(lastUpdated)}
            </span>
          )}
          <button
            type="button"
            onClick={() => void fetchOnce()}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-text-muted hover:text-text disabled:opacity-50"
            aria-label="Refresh signals"
          >
            {loading ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
          {error}
        </div>
      )}

      {signals.length === 0 && loading && (
        <div className="mt-6 space-y-2">
          <div className="h-12 rounded-md shimmer" />
          <div className="h-12 rounded-md shimmer" />
          <div className="h-12 rounded-md shimmer" />
        </div>
      )}

      {signals.length === 0 && !loading && !error && (
        <p className="mt-6 text-[14px] text-text-muted">
          No signals in the last 24 hours. We&apos;ll keep watching.
        </p>
      )}

      {signals.length > 0 && (
        <ul className="mt-6 space-y-2">
          {signals.map((s) => (
            <li
              key={s.id}
              className="animate-fade-rise flex items-start gap-3 rounded-lg border border-border/60 bg-surface2/40 px-3 py-2.5"
            >
              <SeverityDot severity={s.severity} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-text">{s.summary}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                  <span>{s.kind}</span>
                  <span>·</span>
                  <span>{s.source}</span>
                  {s.timestamp && (
                    <>
                      <span>·</span>
                      <span className="normal-case tracking-normal text-text-muted/80">
                        {formatTimestamp(s.timestamp)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function mergeSignals(prev: Signal[], incoming: Signal[]): Signal[] {
  if (incoming.length === 0) return prev;
  const seen = new Map<string, Signal>();
  for (const s of incoming) seen.set(s.id, s);
  for (const s of prev) if (!seen.has(s.id)) seen.set(s.id, s);
  return Array.from(seen.values())
    .sort((a, b) => {
      const ta = Date.parse(a.timestamp ?? "") || 0;
      const tb = Date.parse(b.timestamp ?? "") || 0;
      return tb - ta;
    })
    .slice(0, 12);
}

function relativeTime(d: Date): string {
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 5) return "now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.round(diff / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return `${h}h ago`;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function SeverityDot({ severity }: { severity: Signal["severity"] }) {
  const color =
    severity === "high"
      ? "bg-red-400"
      : severity === "med"
      ? "bg-amber-400"
      : "bg-emerald-400";
  return (
    <span
      className={cn(
        "mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full",
        color,
        severity === "high" && "animate-pulse"
      )}
    />
  );
}
