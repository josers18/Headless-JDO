"use client";

import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-end bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="h-full w-full max-w-[560px] overflow-y-auto border-l border-border bg-surface p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            client · {clientId}
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-surface2 hover:text-text"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="mt-6 font-display text-[28px] leading-tight text-text text-balance">
          {detail?.name ?? clientName ?? (
            <span className="inline-block h-[1em] w-[60%] rounded shimmer" />
          )}
        </div>

        {detail?.summary ? (
          <p className="mt-3 text-[14px] leading-relaxed text-text-muted">
            {detail.summary}
          </p>
        ) : state === "streaming" && !detail ? (
          <div className="mt-4 space-y-2">
            <div className="h-4 w-[80%] rounded shimmer" />
            <div className="h-4 w-[65%] rounded shimmer" />
          </div>
        ) : null}

        {error && (
          <div className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
            {error}
          </div>
        )}

        {detail?.profile && (
          <div className="mt-6 grid grid-cols-3 gap-3">
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
                  className="rounded-lg border border-border/60 bg-surface2/40 px-3 py-3"
                >
                  <div className="text-[11px] uppercase tracking-[0.14em] text-text-muted">
                    {k.label}
                  </div>
                  <div className="mt-1 text-[18px] font-medium text-text">
                    {k.value}
                  </div>
                  <div
                    className={`mt-0.5 font-mono text-[11px] ${
                      k.direction === "up"
                        ? "text-emerald-300"
                        : k.direction === "down"
                        ? "text-red-300"
                        : "text-text-muted"
                    }`}
                  >
                    {k.direction === "up" ? "▲" : k.direction === "down" ? "▼" : "—"}{" "}
                    {k.delta}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {detail?.opportunities && detail.opportunities.length > 0 && (
          <Section title="Open opportunities">
            <ul className="divide-y divide-border/60">
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
                <li key={i} className="flex items-start gap-3 text-[13px]">
                  <SeverityDot severity={s.severity} />
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
            <ul className="space-y-3">
              {detail.recommended_actions.map((a, i) => (
                <li
                  key={i}
                  className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2"
                >
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-accent">
                    <span>{a.kind}</span>
                  </div>
                  <div className="mt-1 text-[14px] text-text">{a.title}</div>
                  <div className="mt-1 text-[12px] text-text-muted">
                    {a.rationale}
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {steps.length > 0 && (
          <div className="mt-8">
            <ReasoningTrail steps={steps} defaultOpen={false} />
          </div>
        )}
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
    <div className="mt-8">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-text-muted">
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
    <div className="rounded-lg border border-border/60 bg-surface2/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className="mt-1 text-[13px] text-text">{value ?? "—"}</div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: "low" | "med" | "high" }) {
  const color =
    severity === "high"
      ? "bg-red-400"
      : severity === "med"
      ? "bg-amber-400"
      : "bg-emerald-400";
  return <span className={`mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full ${color}`} />;
}
