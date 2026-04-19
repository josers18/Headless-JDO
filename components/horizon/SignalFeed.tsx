"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Heart,
  Loader2,
  RefreshCw,
  TrendingUp,
  Zap,
} from "lucide-react";
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
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-emerald-400/80",
              loading ? "animate-glow-pulse" : "opacity-70"
            )}
          />
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
            className="flex items-center gap-1.5 rounded-md border border-border-soft px-2.5 py-1 text-[10px] uppercase tracking-[0.14em] text-text-muted transition hover:border-border hover:text-text disabled:opacity-50"
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
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
          {error}
        </div>
      )}

      {signals.length === 0 && loading && (
        <div className="mt-6 space-y-2">
          <div className="h-[58px] rounded-lg shimmer" />
          <div className="h-[58px] rounded-lg shimmer" />
          <div className="h-[58px] rounded-lg shimmer" />
        </div>
      )}

      {signals.length === 0 && !loading && !error && (
        <p className="mt-6 text-[14px] text-text-muted">
          No signals in the last 24 hours. We&apos;ll keep watching.
        </p>
      )}

      {signals.length > 0 && (
        <ul className="mt-6 space-y-2">
          {signals.map((s, idx) => (
            <SignalRow signal={s} key={s.id} index={idx} />
          ))}
        </ul>
      )}
    </div>
  );
}

// Individual signal row. A severity-colored left border + a soft matching
// glow gives bankers an instant visual read. The kind icon on the right
// adds a second layer of pattern recognition (transaction, engagement,
// life event, KPI, risk).
function SignalRow({ signal, index }: { signal: Signal; index: number }) {
  const severityBar =
    signal.severity === "high"
      ? "bg-red-400"
      : signal.severity === "med"
      ? "bg-amber-400"
      : "bg-emerald-400";
  const glowClass =
    signal.severity === "high"
      ? "glow-down"
      : signal.severity === "med"
      ? "glow-warn"
      : undefined;
  const stagger =
    index < 6 ? ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6"][index] : "stagger-6";

  return (
    <li
      className={cn(
        "group relative animate-fade-rise flex items-center gap-4 overflow-hidden rounded-lg border border-border-soft bg-surface px-4 py-3 transition-colors duration-med hover:border-border",
        glowClass,
        stagger
      )}
    >
      <span
        className={cn("absolute left-0 top-0 h-full w-[2px]", severityBar, signal.severity === "high" && "animate-glow-pulse")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-text">{signal.summary}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {signal.client_name && (
            <>
              <span className="normal-case tracking-normal text-text-muted">
                {signal.client_name}
              </span>
              <span>·</span>
            </>
          )}
          <span>{signal.kind}</span>
          <span>·</span>
          <span>{signal.source}</span>
          {signal.timestamp && (
            <>
              <span>·</span>
              <span className="normal-case tracking-normal text-text-muted/80">
                {formatTimestamp(signal.timestamp)}
              </span>
            </>
          )}
        </div>
      </div>
      <KindIcon kind={signal.kind} severity={signal.severity} />
    </li>
  );
}

function KindIcon({
  kind,
  severity,
}: {
  kind: Signal["kind"];
  severity: Signal["severity"];
}) {
  const tone =
    severity === "high"
      ? "text-red-300/80"
      : severity === "med"
      ? "text-amber-300/80"
      : "text-emerald-300/80";
  const Icon =
    kind === "transaction"
      ? Zap
      : kind === "engagement"
      ? Activity
      : kind === "life_event"
      ? Heart
      : kind === "risk"
      ? AlertTriangle
      : TrendingUp;
  return (
    <span className={cn("shrink-0", tone)}>
      <Icon size={13} strokeWidth={2.2} />
    </span>
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
