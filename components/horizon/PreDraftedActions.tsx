"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Loader2,
  Mail,
  Phone,
  Pencil,
  ListTodo,
  X,
  Sparkles,
} from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { cn } from "@/lib/utils";
import { stripDraftDisplayNoise } from "@/lib/client/stripSalesforceIds";
import { ReasoningTrail } from "./ReasoningTrail";
import type { DraftAction } from "@/types/horizon";

// PreDraftedActions shows 2–4 ready-to-approve drafts. The stream produces
// read-only evidence + a JSON payload of drafts. Approve runs a separate
// POST /api/actions that performs the write through salesforce_crm. We
// show optimistic state per card so the banker isn't watching a spinner.

interface StreamedDraft extends DraftAction {
  rationale?: string;
}

type CardStatus =
  | { kind: "idle" }
  | { kind: "executing" }
  | { kind: "done"; recordId?: string; message?: string }
  | { kind: "dismissed" }
  | { kind: "error"; message: string };

export function PreDraftedActions() {
  const { narrative, steps, state, error, start } = useAgentStream();
  const [hasStarted, setHasStarted] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, CardStatus>>({});

  useEffect(() => {
    if (hasStarted) return;
    setHasStarted(true);
    start("/api/drafts", undefined, { method: "GET" }).catch(() => {});
  }, [hasStarted, start]);

  const drafts = useMemo(() => {
    const parsed = tryParseJson<{ drafts?: StreamedDraft[] }>(narrative);
    return Array.isArray(parsed?.drafts) ? parsed?.drafts ?? [] : [];
  }, [narrative]);

  const isLoading = state === "streaming" && drafts.length === 0;

  async function approve(d: StreamedDraft) {
    setStatuses((s) => ({ ...s, [d.id]: { kind: "executing" } }));
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: d }),
      });
      const json = (await res.json().catch(() => null)) as {
        result?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setStatuses((s) => ({
          ...s,
          [d.id]: {
            kind: "error",
            message: json?.error ?? `Execute failed (${res.status})`,
          },
        }));
        return;
      }
      const id = extractRecordId(json?.result ?? "");
      setStatuses((s) => ({
        ...s,
        [d.id]: { kind: "done", recordId: id, message: json?.result ?? "" },
      }));
    } catch (e) {
      setStatuses((s) => ({
        ...s,
        [d.id]: {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  function dismiss(d: StreamedDraft) {
    setStatuses((s) => ({ ...s, [d.id]: { kind: "dismissed" } }));
  }

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h2 className="flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-text-muted">
          <span
            className={cn(
              "inline-block h-[6px] w-[6px] rounded-full bg-accent/80",
              state === "streaming" && "animate-glow-pulse"
            )}
          />
          Pre-drafted actions
        </h2>
        {state === "streaming" && (
          <span className="font-mono text-[10px] text-text-muted/70">
            drafting…
          </span>
        )}
      </div>

      {isLoading && (
        <div className="mt-6 space-y-3">
          <div className="h-[140px] rounded-xl shimmer" aria-hidden />
          <div className="h-[140px] rounded-xl shimmer" aria-hidden />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
          {error}
        </div>
      )}

      {!isLoading && drafts.length === 0 && state !== "streaming" && !error && (
        <p className="mt-6 max-w-prose text-[14px] leading-relaxed text-text-muted">
          No drafts ready. Try again after the morning brief has run.
        </p>
      )}

      {drafts.length > 0 && (
        <ul className="mt-6 space-y-3">
          {drafts.map((d, idx) => {
            const st = statuses[d.id] ?? { kind: "idle" as const };
            if (st.kind === "dismissed") return null;
            return (
              <DraftCard
                key={d.id}
                draft={d}
                index={idx}
                status={st}
                onApprove={() => approve(d)}
                onDismiss={() => dismiss(d)}
              />
            );
          })}
        </ul>
      )}

      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}

// Draft card — framed with a tinted top edge based on the action kind so a
// banker can scan by shape before reading. Email cards have a cool blue bleed,
// call cards a violet bleed, task/update cards a neutral accent. Approve
// gets the shimmering sheen sweep to signal "premium action."
function DraftCard({
  draft,
  index,
  status,
  onApprove,
  onDismiss,
}: {
  draft: StreamedDraft;
  index: number;
  status: CardStatus;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const stagger =
    index === 0 ? "stagger-1" : index === 1 ? "stagger-2" : "stagger-3";
  const kindColor =
    draft.kind === "email"
      ? "from-accent/25 to-transparent"
      : draft.kind === "call"
      ? "from-accent-2/25 to-transparent"
      : draft.kind === "update"
      ? "from-accent-warm/20 to-transparent"
      : "from-emerald-400/18 to-transparent";

  return (
    <li
      className={cn(
        "group relative animate-fade-rise overflow-hidden rounded-xl border border-border-soft bg-surface",
        stagger
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b",
          kindColor
        )}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 bg-card-sheen"
        aria-hidden
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-full",
                draft.kind === "email" && "bg-accent/15 text-accent",
                draft.kind === "call" && "bg-accent-2/15 text-accent-2",
                draft.kind === "update" && "bg-accent-warm/15 text-accent-warm",
                draft.kind === "task" && "bg-emerald-400/15 text-emerald-300"
              )}
            >
              <KindIcon kind={draft.kind} />
            </span>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-muted">
              <span>{draft.kind}</span>
              {typeof draft.confidence === "number" && (
                <>
                  <span className="text-text-muted/40">·</span>
                  <span className="font-mono">
                    {Math.round(draft.confidence)}%
                  </span>
                </>
              )}
            </div>
          </div>
          <div
            className="font-mono text-[10px] text-text-muted/60"
            data-sf-record-id={draft.target_id}
          >
            {draft.target_object}
          </div>
        </div>

        <div className="mt-3 text-[15px] font-medium leading-snug text-text">
          {stripDraftDisplayNoise(draft.title)}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
          {stripDraftDisplayNoise(draft.body)}
        </p>
        {draft.rationale && (
          <div className="mt-3 flex items-start gap-2 text-[12px] italic text-text-muted/80">
            <Sparkles
              size={11}
              className="mt-[3px] shrink-0 text-accent-2/80"
            />
            <span>{stripDraftDisplayNoise(draft.rationale)}</span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {status.kind === "idle" && (
            <>
              <button
                onClick={onDismiss}
                className="flex items-center gap-1.5 rounded-md border border-border-soft px-3 py-1.5 text-[12px] text-text-muted transition hover:border-border hover:text-text"
              >
                <X size={12} />
                Dismiss
              </button>
              <button
                onClick={onApprove}
                className="group/approve relative flex items-center gap-1.5 overflow-hidden rounded-md bg-accent-sheen px-3.5 py-1.5 text-[12px] font-medium text-bg shadow-glow transition hover:shadow-glow-2"
              >
                <Check size={12} strokeWidth={2.6} />
                Approve & execute
                <span className="sheen-overlay" aria-hidden />
              </button>
            </>
          )}
          {status.kind === "executing" && (
            <span className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin text-accent" />
              Writing through salesforce_crm…
            </span>
          )}
          {status.kind === "done" && (
            <span
              className="flex items-center gap-2 text-[12px] text-emerald-300"
              data-sf-record-id={status.recordId ?? undefined}
            >
              <Check size={12} />
              Executed
            </span>
          )}
          {status.kind === "error" && (
            <div className="flex items-center gap-2 text-[12px] text-red-300">
              <X size={12} />
              {status.message}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: DraftAction["kind"] }) {
  if (kind === "email") return <Mail size={13} />;
  if (kind === "call") return <Phone size={13} />;
  if (kind === "update") return <Pencil size={13} />;
  return <ListTodo size={13} />;
}

// Best-effort extraction. /api/actions returns the assistant's text; the
// prompt instructs it to return {"status":"ok","id":"<sf record id>"} but
// Heroku Inference occasionally wraps it — parse lazily.
function extractRecordId(text: string): string | undefined {
  const parsed = tryParseJson<{ id?: string }>(text);
  return parsed?.id;
}
