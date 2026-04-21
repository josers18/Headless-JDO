"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PriorityClient } from "@/types/horizon";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { cn } from "@/lib/utils";
import { ReasoningTrail } from "./ReasoningTrail";
import { ClientDetailSheet } from "./ClientDetailSheet";
import { GhostPrompt } from "./GhostPrompt";
import { BriefRichText } from "./BriefRichText";
import {
  inferSalesforceObjectFromId,
  lightningRecordViewUrl,
} from "@/lib/salesforce/recordLink";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import {
  DraftActionCard,
  type DraftCardStatus,
  type StreamedDraft,
} from "./DraftActionCard";
import { useDrafts } from "./DraftsContext";
import {
  dispatchHorizonFocusClient,
  HORIZON_REFRESH_PRIORITY,
} from "@/lib/client/horizonEvents";
import { ActionRow, type ActionSpec } from "./ActionRow";
import { dispatchAction, isSnoozed } from "@/lib/client/actions/registry";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";

const PQ_GROUPS_KEY = "hz:pq-groups:v1";

type Tier = "critical" | "important" | "watch";

function tierForScore(score: number): Tier {
  if (score >= 90) return "critical";
  if (score >= 70) return "important";
  return "watch";
}

function readGroupOpen(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(PQ_GROUPS_KEY);
    if (!raw) return { today: true, week: true, watch: false };
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      today: o.today !== false,
      week: o.week !== false,
      watch: Boolean(o.watch),
    };
  } catch {
    return { today: true, week: true, watch: false };
  }
}

function writeGroupOpen(next: Record<string, boolean>) {
  try {
    sessionStorage.setItem(PQ_GROUPS_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
}

export function PriorityQueue() {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  /** True until the staggered first fetch is handed to `start` (skeleton vs idle). */
  const [awaitingKickoff, setAwaitingKickoff] = useState(true);
  const [selectedClient, setSelectedClient] = useState<PriorityClient | null>(
    null
  );
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() =>
    typeof window === "undefined"
      ? { today: true, week: true, watch: false }
      : readGroupOpen()
  );

  const {
    drafts,
    statuses,
    approve,
    dismiss,
    setPriorityClientIds,
  } = useDrafts();

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setAwaitingKickoff(false);
      void start("/api/priority", undefined, { method: "GET" }).catch(() => {});
    }, AGENT_STAGGER_MS.priority);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [start]);

  useEffect(() => {
    const fn = () => {
      reset();
      void start("/api/priority", undefined, { method: "GET" }).catch(() => {});
    };
    window.addEventListener(HORIZON_REFRESH_PRIORITY, fn);
    return () => window.removeEventListener(HORIZON_REFRESH_PRIORITY, fn);
  }, [reset, start]);

  const { clients, note } = useMemo(() => parsePriorityPayload(narrative), [
    narrative,
  ]);

  useEffect(() => {
    setPriorityClientIds(clients.map((c) => c.client_id));
  }, [clients, setPriorityClientIds]);

  const grouped = useMemo(() => {
    const today: PriorityClient[] = [];
    const week: PriorityClient[] = [];
    const watch: PriorityClient[] = [];
    for (const c of clients) {
      const t = tierForScore(c.score);
      if (t === "critical") today.push(c);
      else if (t === "important") week.push(c);
      else watch.push(c);
    }
    return { today, week, watch };
  }, [clients]);

  const isLoading =
    state === "streaming" || (state === "idle" && awaitingKickoff);
  const emptyMessage =
    state === "error"
      ? error ?? "Priority queue unavailable."
      : note ?? null;

  const toggleGroup = useCallback((key: "today" | "week" | "watch") => {
    setOpenGroups((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeGroupOpen(next);
      return next;
    });
  }, []);

  const ghostPrompt = useMemo((): { text: string; title: string } | null => {
    if (clients.length === 0) return null;
    if (clients.length >= 4) {
      return {
        text: "Four names are on deck — want similar follow-ups drafted in one batch?",
        title: "Batch drafting for similar follow-ups",
      };
    }
    if (clients.length >= 2) {
      return {
        text: "Want a tight read on what ties the top two rows together?",
        title: "Pattern read across top priority rows",
      };
    }
    return {
      text: "What moved for this client in the last week that pushed them to the top?",
      title: "Recent movement on the #1 priority client",
    };
  }, [clients.length]);

  return (
    <div data-horizon-section="priority">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent-2/80",
              isLoading && "animate-glow-pulse"
            )}
          />
          Priority queue
        </h2>
        {isLoading && (
          <span className="font-mono text-[10px] text-text-muted/70">
            {steps.length > 0
              ? `${steps.length} MCP call${steps.length === 1 ? "" : "s"}`
              : "reasoning…"}
          </span>
        )}
      </div>

      {ghostPrompt && (
        <div className="mt-4">
          <GhostPrompt
            text={ghostPrompt.text}
            title={ghostPrompt.title}
            context="The banker is viewing the priority queue."
          />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {isLoading && clients.length === 0 && (
          <ul className="space-y-1">
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
            <li className="h-[72px] rounded-lg shimmer" aria-hidden />
          </ul>
        )}
        {!isLoading && clients.length === 0 && (
          <p className="py-4 text-sm text-text-muted">
            {emptyMessage ?? "No priorities available yet."}
          </p>
        )}

        {!isLoading && clients.length > 0 && (
          <>
            <PriorityGroup
              id="today"
              label="Today"
              hint="Critical"
              open={openGroups.today ?? true}
              onToggle={() => toggleGroup("today")}
              clients={grouped.today}
              drafts={drafts}
              statuses={statuses}
              onApprove={approve}
              onDismiss={dismiss}
              onOpenClient={(c) => {
                dispatchHorizonFocusClient({
                  name: c.name,
                  clientId: c.client_id,
                });
                setSelectedClient(c);
              }}
            />
            <PriorityGroup
              id="week"
              label="This week"
              hint="Important"
              open={openGroups.week ?? true}
              onToggle={() => toggleGroup("week")}
              clients={grouped.week}
              drafts={drafts}
              statuses={statuses}
              onApprove={approve}
              onDismiss={dismiss}
              onOpenClient={(c) => {
                dispatchHorizonFocusClient({
                  name: c.name,
                  clientId: c.client_id,
                });
                setSelectedClient(c);
              }}
            />
            <PriorityGroup
              id="watch"
              label="Watch"
              hint="Lower urgency"
              open={openGroups.watch ?? false}
              onToggle={() => toggleGroup("watch")}
              clients={grouped.watch}
              drafts={drafts}
              statuses={statuses}
              onApprove={approve}
              onDismiss={dismiss}
              onOpenClient={(c) => {
                dispatchHorizonFocusClient({
                  name: c.name,
                  clientId: c.client_id,
                });
                setSelectedClient(c);
              }}
            />
          </>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}

      {selectedClient && (
        <ClientDetailSheet
          clientId={selectedClient.client_id}
          clientName={selectedClient.name}
          onClose={() => setSelectedClient(null)}
        />
      )}
    </div>
  );
}

function PriorityGroup({
  id,
  label,
  hint,
  open,
  onToggle,
  clients,
  drafts,
  statuses,
  onApprove,
  onDismiss,
  onOpenClient,
}: {
  id: string;
  label: string;
  hint: string;
  open: boolean;
  onToggle: () => void;
  clients: PriorityClient[];
  drafts: StreamedDraft[];
  statuses: Record<string, DraftCardStatus>;
  onApprove: (d: StreamedDraft) => void | Promise<void>;
  onDismiss: (d: StreamedDraft) => void;
  onOpenClient: (c: PriorityClient) => void;
}) {
  if (clients.length === 0) return null;
  const visibleIds = clients
    .filter((c) => !isSnoozed(`priority:${c.client_id}`))
    .map((c) => c.client_id);
  const batchNames = clients
    .filter((c) => visibleIds.includes(c.client_id))
    .map((c) => c.name)
    .slice(0, 6);
  return (
    <section aria-labelledby={`pq-${id}-h`} className="rounded-xl border border-border-soft/40 bg-surface/20">
      <div className="flex items-stretch justify-between gap-2">
        <button
          type="button"
          id={`pq-${id}-h`}
          onClick={onToggle}
          className="flex flex-1 min-h-[44px] items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-surface/40"
        >
          <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-text-muted">
            {open ? (
              <ChevronDown size={14} className="opacity-70" />
            ) : (
              <ChevronRight size={14} className="opacity-70" />
            )}
            {label}
            <span className="rounded-full border border-border-soft px-2 py-0.5 font-mono text-[9px] text-text-muted/80">
              {clients.length}
            </span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-text-muted/60">
            {hint}
          </span>
        </button>
        {/* B-4 — batch actions on the group header. "Prep all" routes one
            AskBar call that briefs every visible client in this tier, so
            the banker can get a group-level picture with one tap instead
            of clicking Prep on each row. */}
        {visibleIds.length > 1 && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void dispatchAction({
                kind: "investigate",
                label: `Prep all ${visibleIds.length}`,
                question: `Prep me for the ${visibleIds.length} clients in my ${label.toLowerCase()} tier: ${batchNames.join(", ")}. For each, give me the 1-sentence situation + 1-sentence next step.`,
              });
            }}
            className="mr-2 my-2 rounded-md border border-border-soft px-3 text-[11px] text-text-muted transition hover:border-accent/40 hover:text-text"
          >
            Prep all {visibleIds.length}
          </button>
        )}
      </div>
      {open && (
        <ul className="space-y-1 border-t border-border-soft/30 px-2 pb-2 pt-1">
          {clients
            .filter((c) => !isSnoozed(`priority:${c.client_id}`))
            .map((c, idx) => {
              const primary: ActionSpec = {
                label: "Prep me",
                action: {
                  kind: "prep",
                  label: "Prep me",
                  clientId: c.client_id,
                  clientName: c.name,
                },
              };
              const secondary: ActionSpec = {
                label: "Why?",
                action: {
                  kind: "investigate",
                  label: "Why?",
                  question: `Why is ${c.name} ranked here in my priority queue today? Quote the specific signals.`,
                  context: `Client id: ${c.client_id}. Score: ${c.score}.`,
                },
              };
              const overflow: ActionSpec[] = [
                {
                  label: "Draft email",
                  action: {
                    kind: "draft_email",
                    label: "Draft email",
                    clientId: c.client_id,
                    clientName: c.name,
                    reason: c.reason,
                  },
                },
                {
                  label: "Draft call script",
                  action: {
                    kind: "draft_call",
                    label: "Draft call script",
                    clientId: c.client_id,
                    clientName: c.name,
                    reason: c.reason,
                  },
                },
                {
                  label: "Create task",
                  action: {
                    kind: "create_task",
                    label: "Create task",
                    clientId: c.client_id,
                    clientName: c.name,
                    subject: `Follow up with ${c.name}`,
                    dueHint: "this week",
                  },
                },
                {
                  label: "Snooze 1 hour",
                  action: {
                    kind: "snooze",
                    label: "Snooze 1 hour",
                    itemKey: `priority:${c.client_id}`,
                    minutes: 60,
                  },
                },
                {
                  label: "Dismiss",
                  action: {
                    kind: "dismiss",
                    label: "Dismiss",
                    itemKey: `priority:${c.client_id}`,
                  },
                },
              ];

              return (
                <li key={c.client_id} className="animate-fade-rise">
                  <ActionRow
                    onRowClick={() => onOpenClient(c)}
                    primary={primary}
                    secondary={secondary}
                    overflow={overflow}
                  >
                    <div className="grid grid-cols-[56px_1fr_auto] items-center gap-5">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface text-[12px] font-mono tabular-nums text-text-muted group-hover:border-accent/40 group-hover:text-accent">
                        {String(idx + 1).padStart(2, "0")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[15px] font-medium text-text">
                            <PriorityClientNameLink
                              name={c.name}
                              clientId={c.client_id}
                            />
                          </span>
                          <ChevronRight
                            size={13}
                            className="shrink-0 text-text-muted/40 transition-transform duration-fast group-hover:translate-x-0.5 group-hover:text-accent/80"
                          />
                        </div>
                        <div className="mt-1 truncate text-[13px] leading-relaxed text-text-muted">
                          <BriefRichText
                            text={c.reason}
                            clientId={c.client_id}
                            clientName={c.name}
                          />
                        </div>
                        {c.sources && c.sources.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-muted/70">
                            {c.sources.map((s) => (
                              <span
                                key={s}
                                className="rounded border border-border-soft px-1.5 py-0.5"
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <ScorePill score={c.score} />
                    </div>
                  </ActionRow>
                  {drafts
                    .filter((d) => d.target_id === c.client_id)
                    .map((d, j) => {
                      const st = statuses[d.id] ?? { kind: "idle" as const };
                      if (st.kind === "dismissed") return null;
                      return (
                        <DraftActionCard
                          key={d.id}
                          draft={d}
                          index={j}
                          status={st}
                          compact
                          onApprove={() => void onApprove(d)}
                          onDismiss={() => onDismiss(d)}
                        />
                      );
                    })}
                </li>
              );
            })}
        </ul>
      )}
    </section>
  );
}

type TierLabel = "critical" | "important" | "watch";

function scoreTier(score: number): TierLabel {
  if (score >= 90) return "critical";
  if (score >= 70) return "important";
  return "watch";
}

const TIER_LABEL: Record<TierLabel, string> = {
  critical: "Critical",
  important: "Important",
  watch: "Watch",
};

const TIER_CLASS: Record<TierLabel, string> = {
  critical: "text-accent border-accent/40 bg-accent/10",
  important: "text-text border-border-soft bg-surface/80",
  watch: "text-text-muted border-border-soft bg-surface/50",
};

function ScorePill({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const pct = `${clamped}%`;
  const tier = scoreTier(clamped);
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="relative h-[6px] w-[72px] overflow-hidden rounded-full bg-border-soft">
        <div
          className="h-full rounded-full bg-accent-sheen"
          style={{
            width: pct,
            boxShadow:
              tier === "critical"
                ? "0 0 14px rgba(91, 141, 239, 0.65)"
                : tier === "important"
                  ? "0 0 10px rgba(91, 141, 239, 0.45)"
                  : "0 0 4px rgba(91, 141, 239, 0.2)",
          }}
        />
      </div>
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-[0.14em] font-mono",
          TIER_CLASS[tier]
        )}
        data-score={clamped.toFixed(0)}
      >
        {TIER_LABEL[tier]}
      </span>
    </div>
  );
}

interface PriorityPayload {
  clients: PriorityClient[];
  note: string | null;
}

function PriorityClientNameLink({
  name,
  clientId,
}: {
  name: string;
  clientId: string;
}) {
  const base = useSfInstanceUrl();
  const href =
    base && inferSalesforceObjectFromId(clientId)
      ? lightningRecordViewUrl(base, clientId)
      : null;
  if (!href) {
    return <span>{name}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="hover:text-accent"
      onClick={(e) => e.stopPropagation()}
    >
      {name}
    </a>
  );
}

function parsePriorityPayload(text: string): PriorityPayload {
  if (!text || !text.trim()) return { clients: [], note: null };
  const parsed = tryParseJson<{
    clients?: PriorityClient[];
    error?: string;
  }>(text);
  if (!parsed) return { clients: [], note: null };
  if (Array.isArray(parsed.clients) && parsed.clients.length > 0) {
    return { clients: parsed.clients, note: null };
  }
  if (typeof parsed.error === "string") {
    return { clients: [], note: parsed.error };
  }
  return { clients: [], note: null };
}
