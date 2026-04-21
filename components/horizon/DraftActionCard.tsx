"use client";

import { useEffect, useRef, useState } from "react";
import {
  Check,
  Loader2,
  Mail,
  MoreHorizontal,
  Phone,
  Pencil,
  ListTodo,
  X,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { stripDraftDisplayNoise } from "@/lib/client/stripSalesforceIds";
import { tryParseJson } from "@/lib/client/jsonStream";
import type { DraftAction } from "@/types/horizon";
import {
  inferSalesforceObjectFromId,
  lightningRecordViewUrl,
} from "@/lib/salesforce/recordLink";
import { BriefRichText } from "./BriefRichText";
import { useSfInstanceUrl } from "./SfInstanceProvider";
import { dispatchAction } from "@/lib/client/actions/registry";

export interface StreamedDraft extends DraftAction {
  rationale?: string;
}

export type DraftCardStatus =
  | { kind: "idle" }
  | { kind: "executing" }
  | { kind: "done"; recordId?: string; message?: string }
  | { kind: "dismissed" }
  | { kind: "error"; message: string };

export function extractRecordIdFromActionResult(text: string): string | undefined {
  const parsed = tryParseJson<{ id?: string }>(text);
  if (parsed?.id && typeof parsed.id === "string") return parsed.id;
  const m = text.match(/"id"\s*:\s*"([a-zA-Z0-9]{15,18})"/);
  if (m?.[1]) return m[1];
  const bare = text.match(/\b([a-zA-Z0-9]{15,18})\b/);
  return bare?.[1];
}

/** I-5 — three visible actions + overflow (Prep, Dismiss, Approve + ⋯). */
function DraftIdleActions({
  draft,
  onApprove,
  onDismiss,
}: {
  draft: StreamedDraft;
  onApprove: () => void;
  onDismiss: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      {draft.target_id && (
        <button
          type="button"
          onClick={() =>
            void dispatchAction({
              kind: "prep",
              label: "Prep me",
              clientId: draft.target_id!,
            })
          }
          className="flex min-h-[44px] items-center gap-1.5 rounded-md border border-border-soft px-3 py-1.5 text-[12px] text-text-muted transition hover:border-border hover:text-text md:min-h-0"
        >
          <Sparkles size={12} />
          <span className="hidden sm:inline">Prep me</span>
        </button>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-md border border-border-soft px-3 py-1.5 text-[12px] text-text-muted transition hover:border-border hover:text-text md:min-h-0 md:min-w-0"
      >
        <X size={12} />
        <span className="hidden sm:inline">Dismiss</span>
      </button>
      <button
        type="button"
        onClick={onApprove}
        className="group/approve relative flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 overflow-hidden rounded-md bg-accent-sheen px-3.5 py-1.5 text-[12px] font-medium text-bg shadow-glow transition hover:shadow-glow-2 md:min-h-0 md:min-w-0"
      >
        <Check size={12} strokeWidth={2.6} />
        <span className="hidden sm:inline">Approve & execute</span>
        <span className="sheen-overlay" aria-hidden />
      </button>

      <div className="relative" ref={wrapRef}>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="inline-flex size-10 items-center justify-center rounded-md border border-border-soft text-text-muted transition hover:border-border hover:text-text md:size-9"
          title="More actions"
        >
          <MoreHorizontal size={16} />
        </button>
        {open && (
          <div
            role="menu"
            className="absolute bottom-[calc(100%+6px)] right-0 z-30 w-[220px] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)] sm:bottom-auto sm:top-[calc(100%+6px)]"
          >
            {draft.kind === "task" && draft.target_id && (
              <button
                type="button"
                role="menuitem"
                className="flex w-full px-3 py-2.5 text-left text-[12px] text-amber-200 transition hover:bg-surface2"
                onClick={() => {
                  setOpen(false);
                  void dispatchAction({
                    kind: "do_for_me",
                    label: "Do this for me",
                    plan: {
                      kind: "task",
                      clientId: draft.target_id,
                      subject: draft.title,
                    },
                    reason: draft.body,
                  });
                }}
              >
                Do this for me
              </button>
            )}
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2.5 text-left text-[12px] text-text transition hover:bg-surface2"
              onClick={() => {
                setOpen(false);
                void dispatchAction({
                  kind: "investigate",
                  label: "Edit draft",
                  question: `Sharpen this ${draft.kind} draft before I approve.\nTitle: ${draft.title}\nBody: ${draft.body}`,
                  context: draft.target_id
                    ? `Client id: ${draft.target_id}`
                    : undefined,
                });
              }}
            >
              Edit draft
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2.5 text-left text-[12px] text-text transition hover:bg-surface2"
              onClick={() => {
                setOpen(false);
                void dispatchAction({
                  kind: "snooze",
                  label: "Snooze 1d",
                  itemKey: `draft:${draft.id}`,
                  minutes: 1440,
                });
              }}
            >
              Snooze 1d
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full px-3 py-2.5 text-left text-[12px] text-text transition hover:bg-surface2"
              onClick={() => {
                setOpen(false);
                void dispatchAction({
                  kind: "investigate",
                  label: "Reassign",
                  question: `Who else on the team should own the next step for this ${draft.kind} (${draft.title})? Internal reassignment only — draft a recommendation.`,
                  context: draft.target_id
                    ? `Client id: ${draft.target_id}`
                    : undefined,
                });
              }}
            >
              Reassign
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function KindIcon({ kind }: { kind: DraftAction["kind"] }) {
  if (kind === "email") return <Mail size={13} />;
  if (kind === "call") return <Phone size={13} />;
  if (kind === "update") return <Pencil size={13} />;
  return <ListTodo size={13} />;
}

export function DraftActionCard({
  draft,
  index,
  status,
  onApprove,
  onDismiss,
  compact,
}: {
  draft: StreamedDraft;
  index: number;
  status: DraftCardStatus;
  onApprove: () => void;
  onDismiss: () => void;
  compact?: boolean;
}) {
  const base = useSfInstanceUrl();
  const targetHref =
    base && inferSalesforceObjectFromId(draft.target_id)
      ? lightningRecordViewUrl(base, draft.target_id)
      : null;

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

  if (compact) {
    return (
      <div
        className={cn(
          "mt-2 rounded-lg border border-border-soft/80 bg-surface2/50 px-3 py-2.5",
          stagger
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <span
              className={cn(
                "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                draft.kind === "email" && "bg-accent/15 text-accent",
                draft.kind === "call" && "bg-accent-2/15 text-accent-2",
                draft.kind === "update" && "bg-accent-warm/15 text-accent-warm",
                draft.kind === "task" && "bg-emerald-400/15 text-emerald-300"
              )}
            >
              <KindIcon kind={draft.kind} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12px] font-medium text-text">
                <BriefRichText
                  text={stripDraftDisplayNoise(draft.title)}
                  clientId={draft.target_id}
                  linkClassName="font-semibold"
                  probeCoListedNames
                />
              </div>
              <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-text-muted/70">
                {draft.kind}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {status.kind === "idle" && (
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={onDismiss}
                  className="min-h-[44px] min-w-[44px] rounded-md border border-border-soft px-2 text-[11px] text-text-muted hover:border-border hover:text-text md:min-h-0 md:min-w-0"
                >
                  <X size={12} className="mx-auto md:mx-0" />
                </button>
                <button
                  type="button"
                  onClick={onApprove}
                  className="min-h-[44px] min-w-[44px] rounded-md bg-accent-sheen px-2.5 text-[11px] font-medium text-bg shadow-glow md:min-h-0 md:min-w-0"
                >
                  <Check size={12} className="mx-auto md:mx-0" />
                </button>
              </div>
            )}
            {status.kind === "executing" && (
              <Loader2 size={12} className="animate-spin text-accent" />
            )}
            {status.kind === "done" && (
              <span className="text-[11px] text-emerald-300">Done</span>
            )}
            {status.kind === "error" && (
              <span className="max-w-[120px] text-right text-[10px] text-red-300">
                {status.message}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            <div
              className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-muted"
              title={
                typeof draft.confidence === "number"
                  ? `Internal fit estimate: ${Math.round(draft.confidence)}%`
                  : undefined
              }
            >
              <span>{draft.kind}</span>
            </div>
          </div>
          {targetHref ? (
            <a
              href={targetHref}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 font-mono text-[10px] text-accent underline decoration-accent/35 underline-offset-2 hover:decoration-accent"
              data-sf-record-id={draft.target_id}
            >
              {draft.target_object}
            </a>
          ) : (
            <div
              className="font-mono text-[10px] text-text-muted/60"
              data-sf-record-id={draft.target_id}
            >
              {draft.target_object}
            </div>
          )}
        </div>

        <div className="mt-3 text-[15px] font-medium leading-snug text-text">
          <BriefRichText
            text={stripDraftDisplayNoise(draft.title)}
            clientId={draft.target_id}
            linkClassName="font-semibold"
            probeCoListedNames
          />
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
          <BriefRichText
            text={stripDraftDisplayNoise(draft.body)}
            clientId={draft.target_id}
            probeCoListedNames
          />
        </p>
        {draft.rationale && (
          <div className="mt-3 flex items-start gap-2 text-[12px] italic text-text-muted/80">
            <Sparkles
              size={11}
              className="mt-[3px] shrink-0 text-accent-2/80"
            />
            <span>
              <BriefRichText
                text={stripDraftDisplayNoise(draft.rationale)}
                clientId={draft.target_id}
                probeCoListedNames
              />
            </span>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {status.kind === "idle" && (
            <DraftIdleActions draft={draft} onApprove={onApprove} onDismiss={onDismiss} />
          )}
          {status.kind === "executing" && (
            <span className="flex items-center gap-2 text-[12px] text-text-muted">
              <Loader2 size={12} className="animate-spin text-accent" />
              Writing through CRM…
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
