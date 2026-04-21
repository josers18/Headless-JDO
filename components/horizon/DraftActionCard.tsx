"use client";

import { Check, Loader2, Mail, Phone, Pencil, ListTodo, X, Sparkles } from "lucide-react";
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
          />
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
          <BriefRichText
            text={stripDraftDisplayNoise(draft.body)}
            clientId={draft.target_id}
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
              />
            </span>
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          {status.kind === "idle" && (
            <>
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
