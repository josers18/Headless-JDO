"use client";

import { useEffect, useMemo } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, X } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { cn } from "@/lib/utils";
import { ReasoningTrail } from "./ReasoningTrail";
import type { McpServerName } from "@/types/horizon";

// ClientDetailSheet opens from the Priority Queue. It streams /api/client/[id]
// live so the banker sees MCP activity immediately; when the JSON object
// closes mid-stream we render the 360° view. Escape closes it.
interface ClientDetail {
  client_id: string;
  name: string;
  summary: string;
  profile: {
    segment: string | null;
    relationship_since: string | null;
    total_aum: string | null;
  };
  opportunities: Array<{
    id: string;
    name: string;
    stage: string;
    amount?: string;
    close_date?: string;
  }>;
  tasks: Array<{
    id: string;
    subject: string;
    status: string;
    due_date?: string;
  }>;
  cases: Array<{
    id: string;
    subject: string;
    status: string;
    priority?: string;
  }>;
  signals: Array<{
    kind: string;
    summary: string;
    severity: "low" | "med" | "high";
    source: McpServerName;
  }>;
  kpis: Array<{
    label: string;
    value: string;
    delta: string;
    direction: "up" | "down" | "flat";
  }>;
  recommended_actions: Array<{
    kind: "task" | "email" | "update" | "call";
    title: string;
    rationale: string;
  }>;
}

export function ClientDetailSheet({
  clientId,
  clientName,
  onClose,
}: {
  clientId: string;
  clientName?: string;
  onClose: () => void;
}) {
  const { narrative, steps, state, error, start } = useAgentStream();

  useEffect(() => {
    const url = clientName
      ? `/api/client/${encodeURIComponent(clientId)}?name=${encodeURIComponent(clientName)}`
      : `/api/client/${encodeURIComponent(clientId)}`;
    start(url, undefined, { method: "GET" }).catch(() => {});
  }, [clientId, clientName, start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const detail = useMemo(
    () => tryParseJson<ClientDetail>(narrative),
    [narrative]
  );

  const initials = useMemo(() => {
    const n = detail?.name ?? clientName ?? "";
    return n
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }, [detail?.name, clientName]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/60 backdrop-blur-[4px] animate-fade-in"
      onClick={onClose}
    >
      <aside
        className="relative h-full w-full max-w-[600px] overflow-y-auto border-l border-border-soft bg-surface animate-fade-rise"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Ambient hero glow at the top of the sheet */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-hero-glow drift"
          aria-hidden
        />

        <div className="relative px-8 pb-16 pt-8">
          <div className="flex items-center justify-between">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
              client · {clientId}
            </div>
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-text-muted transition hover:bg-surface2 hover:text-text"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-8 flex items-start gap-4">
            <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-sheen font-display text-[18px] font-semibold text-bg shadow-glow">
              {initials || "—"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-display text-[30px] leading-tight tracking-tight text-text text-balance">
                {detail?.name ?? clientName ?? (
                  <span className="inline-block h-[1em] w-[60%] rounded shimmer" />
                )}
              </div>
              {detail?.summary ? (
                <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-text-muted">
                  {detail.summary}
                </p>
              ) : state === "streaming" && !detail ? (
                <div className="mt-3 space-y-2">
                  <div className="h-4 w-[80%] rounded shimmer" />
                  <div className="h-4 w-[65%] rounded shimmer" />
                </div>
              ) : null}
            </div>
          </div>

          {error && (
            <div className="mt-5 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
              {error}
            </div>
          )}

          {detail?.profile && (
            <div className="mt-7 grid grid-cols-3 gap-3">
              <ProfileCell label="Segment" value={detail.profile.segment} />
              <ProfileCell label="Since" value={detail.profile.relationship_since} />
              <ProfileCell label="AUM" value={detail.profile.total_aum} />
            </div>
          )}

          {detail?.kpis && detail.kpis.length > 0 && (
            <Section title="Portfolio KPIs">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {detail.kpis.map((k, i) => (
                  <div
                    key={i}
                    className="relative overflow-hidden rounded-xl border border-border-soft bg-surface p-4"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-card-sheen opacity-50" aria-hidden />
                    <div className="relative flex items-center justify-between">
                      <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                        {k.label}
                      </div>
                      <DirectionBadge direction={k.direction} />
                    </div>
                    <div className="relative mt-2 font-display text-[22px] font-medium tracking-tight text-text">
                      {k.value}
                    </div>
                    <div
                      className={cn(
                        "relative mt-0.5 font-mono text-[11px]",
                        k.direction === "up"
                          ? "text-emerald-300"
                          : k.direction === "down"
                          ? "text-red-300"
                          : "text-text-muted"
                      )}
                    >
                      {k.delta}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {detail?.opportunities && detail.opportunities.length > 0 && (
            <Section title="Open opportunities">
              <ul className="divide-y divide-border-soft">
                {detail.opportunities.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-4 py-3">
                    <div>
                      <div className="text-[14px] text-text">{o.name}</div>
                      <div className="mt-0.5 text-[12px] text-text-muted">
                        {o.stage}
                        {o.close_date ? ` · closes ${o.close_date}` : ""}
                      </div>
                    </div>
                    {o.amount && (
                      <div className="shrink-0 font-mono text-[12px] text-accent">
                        {o.amount}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail?.tasks && detail.tasks.length > 0 && (
            <Section title="Recent tasks">
              <ul className="space-y-2">
                {detail.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 text-[13px]"
                  >
                    <span className="text-text">{t.subject}</span>
                    <span className="shrink-0 font-mono text-[11px] text-text-muted">
                      {t.status}
                      {t.due_date ? ` · ${t.due_date}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail?.cases && detail.cases.length > 0 && (
            <Section title="Open cases">
              <ul className="space-y-2">
                {detail.cases.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 text-[13px]"
                  >
                    <span className="text-text">{c.subject}</span>
                    <span className="shrink-0 font-mono text-[11px] text-text-muted">
                      {c.status}
                      {c.priority ? ` · ${c.priority}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail?.signals && detail.signals.length > 0 && (
            <Section title="Behavioral signals">
              <ul className="space-y-2">
                {detail.signals.map((s, i) => (
                  <li
                    key={i}
                    className="relative flex items-start gap-3 overflow-hidden rounded-lg border border-border-soft bg-surface px-3 py-2.5 text-[13px]"
                  >
                    <span
                      className={cn(
                        "absolute left-0 top-0 h-full w-[2px]",
                        s.severity === "high"
                          ? "bg-red-400"
                          : s.severity === "med"
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                      )}
                      aria-hidden
                    />
                    <div className="flex-1">
                      <div className="text-text">{s.summary}</div>
                      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted">
                        {s.kind} · {s.source}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {detail?.recommended_actions && detail.recommended_actions.length > 0 && (
            <Section title="Recommended actions">
              <ul className="space-y-2">
                {detail.recommended_actions.map((a, i) => (
                  <li
                    key={i}
                    className="relative overflow-hidden rounded-xl border border-accent/25 bg-accent/5 px-4 py-3"
                  >
                    <div className="pointer-events-none absolute inset-0 bg-card-sheen opacity-60" aria-hidden />
                    <div className="relative">
                      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-accent">
                        <span>{a.kind}</span>
                      </div>
                      <div className="mt-1 text-[14px] font-medium text-text">
                        {a.title}
                      </div>
                      <div className="mt-1 text-[12px] text-text-muted">
                        {a.rationale}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {steps.length > 0 && (
            <div className="mt-10">
              <ReasoningTrail steps={steps} defaultOpen={false} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-10">
      <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
        <span className="inline-block h-[6px] w-[6px] rounded-full bg-accent/50" />
        {title}
      </div>
      {children}
    </div>
  );
}

function ProfileCell({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border-soft bg-surface px-3 py-2.5">
      <div className="pointer-events-none absolute inset-0 bg-card-sheen opacity-60" aria-hidden />
      <div className="relative text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className="relative mt-1 text-[13px] font-medium text-text">
        {value ?? "—"}
      </div>
    </div>
  );
}

function DirectionBadge({
  direction,
}: {
  direction: "up" | "down" | "flat";
}) {
  if (direction === "up") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/15 text-emerald-300">
        <ArrowUpRight size={10} strokeWidth={2.6} />
      </span>
    );
  }
  if (direction === "down") {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-400/15 text-red-300">
        <ArrowDownRight size={10} strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-surface2 text-text-muted">
      <Minus size={10} strokeWidth={2.6} />
    </span>
  );
}
