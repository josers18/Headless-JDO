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
import { BriefRichText } from "./BriefRichText";
import { ClientDetailSheet } from "./ClientDetailSheet";
import {
  inferSalesforceObjectFromId,
  lightningRecordViewUrl,
} from "@/lib/salesforce/recordLink";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { dispatchHorizonFocusClient } from "@/lib/client/horizonEvents";
import { dispatchAction } from "@/lib/client/actions/registry";

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
  const [sheet, setSheet] = useState<{
    clientId: string;
    clientName?: string;
  } | null>(null);
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
    <div data-horizon-section="signals">
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
            <SignalRow
              signal={s}
              key={s.id}
              index={idx}
              onOpenDetail={() => {
                if (!s.client_id) return;
                dispatchHorizonFocusClient({
                  name: s.client_name ?? "Client",
                  clientId: s.client_id,
                });
                setSheet({
                  clientId: s.client_id,
                  clientName: s.client_name,
                });
              }}
            />
          ))}
        </ul>
      )}

      {sheet && (
        <ClientDetailSheet
          clientId={sheet.clientId}
          clientName={sheet.clientName}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

// Individual signal row. A severity-colored left border + a soft matching
// glow gives bankers an instant visual read. The kind icon on the right
// adds a second layer of pattern recognition (transaction, engagement,
// life event, KPI, risk).
function SignalRow({
  signal,
  index,
  onOpenDetail,
}: {
  signal: Signal;
  index: number;
  onOpenDetail: () => void;
}) {
  const base = useSfInstanceUrl();
  const clientHref =
    signal.client_id &&
    base &&
    inferSalesforceObjectFromId(signal.client_id)
      ? lightningRecordViewUrl(base, signal.client_id)
      : null;

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

  const interactive = Boolean(signal.client_id);

  return (
    <li
      className={cn(
        "group relative animate-fade-rise flex items-center gap-4 overflow-hidden rounded-lg border border-border-soft bg-surface px-4 py-3 transition-colors duration-med hover:border-border",
        interactive && "cursor-pointer",
        glowClass,
        stagger
      )}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      onClick={() => {
        if (interactive) onOpenDetail();
      }}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail();
        }
      }}
    >
      <span
        className={cn("absolute left-0 top-0 h-full w-[2px]", severityBar, signal.severity === "high" && "animate-glow-pulse")}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] text-text">
            <BriefRichText
              text={signal.summary}
              clientId={signal.client_id}
              clientName={signal.client_name}
            />
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
          {signal.client_name && (
            <>
              {clientHref ? (
                <a
                  href={clientHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="normal-case tracking-normal text-accent underline decoration-accent/35 underline-offset-2 hover:decoration-accent"
                  onClick={(e) => e.stopPropagation()}
                >
                  {signal.client_name}
                </a>
              ) : (
                <span className="normal-case tracking-normal text-text-muted">
                  {signal.client_name}
                </span>
              )}
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

      {/* A-4 — per-signal quick actions. Shown on row hover so the feed
          still reads as ambient awareness, but every signal is one tap
          from an agent investigation or a drafted response. Kind-aware
          CTA: transactions → "Call", risk → "Draft note", engagement →
          "Why?", default → "Why?". */}
      <div
        className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        data-actionrow-noclick
      >
        {signal.client_id && signal.kind === "transaction" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void dispatchAction({
                kind: "draft_call",
                label: "Call",
                clientId: signal.client_id,
                clientName: signal.client_name,
                reason: signal.summary,
              });
            }}
            className="rounded-md border border-border-soft px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-muted transition hover:border-border hover:text-text"
          >
            Call
          </button>
        )}
        {signal.client_id && signal.severity === "high" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void dispatchAction({
                kind: "draft_email",
                label: "Respond",
                clientId: signal.client_id,
                clientName: signal.client_name,
                reason: signal.summary,
              });
            }}
            className="rounded-md border border-border-soft px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-muted transition hover:border-border hover:text-text"
          >
            Respond
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void dispatchAction({
              kind: "investigate",
              label: "Why?",
              question: `Investigate this signal: "${signal.summary}". What's the context from data_360 and salesforce_crm, and what should I do next?`,
              context: signal.client_id
                ? `Client id: ${signal.client_id}`
                : undefined,
            });
          }}
          className="rounded-md border border-border-soft px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-text-muted transition hover:border-border hover:text-text"
        >
          Why?
        </button>
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
  const sorted = Array.from(seen.values()).sort((a, b) => {
    const ta = Date.parse(a.timestamp ?? "") || 0;
    const tb = Date.parse(b.timestamp ?? "") || 0;
    return tb - ta;
  });
  return collapseNoise(sorted).slice(0, 12);
}

/**
 * F-7 — noise collapse. Beyond id-dedup, bin "created/updated" pairs for the
 * same client+kind that fire within 60 seconds of each other so the feed
 * reads like ambient awareness instead of a CRUD audit log. We always keep
 * the newest row and drop older duplicates of the same bucket.
 */
function collapseNoise(signals: Signal[]): Signal[] {
  const out: Signal[] = [];
  const bucketSeen = new Set<string>();
  for (const s of signals) {
    const bucket = noiseBucket(s);
    if (bucket && bucketSeen.has(bucket)) continue;
    if (bucket) bucketSeen.add(bucket);
    out.push(s);
  }
  return out;
}

function noiseBucket(s: Signal): string | null {
  const t = Date.parse(s.timestamp ?? "");
  if (!t) return null;
  const client = s.client_id ?? s.client_name ?? "";
  if (!client) return null;
  const minuteBin = Math.floor(t / 60_000);
  return `${client}::${s.kind}::${minuteBin}`;
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
