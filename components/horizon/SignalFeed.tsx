"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronRight,
  ClipboardList,
  Heart,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
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
import { primaryActionForSignal } from "@/lib/signals/signalRowActions";
import type { HorizonAction } from "@/lib/client/actions/registry";
import type { McpServerName } from "@/types/horizon";
import { useSectionContentReporter } from "./SectionContentPresence";

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

  const reportPresence = useSectionContentReporter("signals");
  useEffect(() => {
    reportPresence(signals.length > 0);
  }, [signals.length, reportPresence]);

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

// I-3 / P-4 — compact rail row: ≤2 lines, source on hover, right-edge icon primary.
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
    index < 6
      ? ["stagger-1", "stagger-2", "stagger-3", "stagger-4", "stagger-5", "stagger-6"][index]
      : "stagger-6";

  const interactive = Boolean(signal.client_id);
  const primary = primaryActionForSignal(signal);
  const PrimaryIcon = iconForPrimaryAction(primary.action);
  const sourceHover = sourceChipLabel(signal.source);
  const displayName = signal.client_name
    ? truncateEllipsis(signal.client_name, 24)
    : null;

  return (
    <li
      title={`${signal.summary}${sourceHover ? ` — ${sourceHover}` : ""}`}
      className={cn(
        "group relative animate-fade-rise flex items-start gap-3 overflow-hidden rounded-lg border border-border-soft bg-surface px-3 py-2.5 transition-colors duration-med hover:border-border",
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
        className={cn(
          "absolute left-0 top-0 h-full w-[2px]",
          severityBar,
          signal.severity === "high" && "animate-glow-pulse"
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[13px] leading-snug text-text">
          <BriefRichText
            text={signal.summary}
            clientId={signal.client_id}
            clientName={signal.client_name}
          />
        </p>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[10px] text-text-muted">
          <div className="min-w-0 truncate normal-case tracking-normal">
            {displayName && (
              <>
                {clientHref ? (
                  <a
                    href={clientHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-text/90 underline decoration-border underline-offset-2 hover:decoration-accent hover:text-accent"
                    title={signal.client_name}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {displayName}
                  </a>
                ) : (
                  <span title={signal.client_name}>{displayName}</span>
                )}
                <span className="text-text-muted/50"> · </span>
              </>
            )}
            <span className="font-mono text-[10px] text-text-muted/80">
              {signal.timestamp ? formatTimestamp(signal.timestamp) : ""}
            </span>
          </div>
          <span className="hidden max-w-[100px] shrink-0 truncate font-mono text-[9px] uppercase tracking-[0.1em] text-text-muted/70 xl:group-hover:inline">
            {sourceHover}
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 flex-col items-end gap-1"
        data-actionrow-noclick
      >
        <div className="hidden items-center gap-0.5 xl:group-hover:flex">
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
              className="rounded border border-border-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted hover:border-border"
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
              className="rounded border border-border-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted hover:border-border"
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
                question: `Investigate this signal: "${signal.summary}". What is the context from unified data and CRM, and what should I do next?`,
                context: signal.client_id
                  ? `Client id: ${signal.client_id}`
                  : undefined,
              });
            }}
            className="rounded border border-border-soft px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-text-muted hover:border-border"
          >
            Why?
          </button>
        </div>
        <button
          type="button"
          aria-label={primary.aria}
          title={primary.action.label}
          onClick={(e) => {
            e.stopPropagation();
            void dispatchAction(primary.action);
          }}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-border-soft text-text-muted transition hover:border-accent/50 hover:bg-surface2 hover:text-accent"
        >
          <PrimaryIcon size={15} strokeWidth={2.1} />
        </button>
      </div>

    </li>
  );
}

function truncateEllipsis(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function sourceChipLabel(s: McpServerName): string {
  if (s === "salesforce_crm") return "CRM";
  if (s === "data_360") return "Unified";
  if (s === "tableau_next") return "Book KPIs";
  return "Toolkit";
}

function iconForPrimaryAction(a: HorizonAction) {
  switch (a.kind) {
    case "draft_call":
      return Phone;
    case "draft_email":
      return Mail;
    case "prep":
      return ClipboardList;
    case "investigate": {
      if (a.label === "Review") return ChevronRight;
      if (a.label === "Log outcome") return Check;
      if (a.label === "Acknowledge") return AlertTriangle;
      return MessageSquare;
    }
    default:
      return MessageSquare;
  }
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
