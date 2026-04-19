"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Mail, Phone, Pencil, ListTodo, X } from "lucide-react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
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
        <h2 className="text-xs uppercase tracking-[0.18em] text-text-muted">
          Pre-drafted actions
        </h2>
        {state === "streaming" && (
          <span className="text-[10px] font-mono text-text-muted/70">
            drafting…
          </span>
        )}
      </div>

      {isLoading && (
        <div className="mt-6 space-y-3">
          <div className="h-20 rounded-lg shimmer" aria-hidden />
          <div className="h-20 rounded-lg shimmer" aria-hidden />
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
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
          {drafts.map((d) => {
            const st = statuses[d.id] ?? { kind: "idle" as const };
            if (st.kind === "dismissed") return null;
            return (
              <li
                key={d.id}
                className="animate-fade-rise rounded-lg border border-border/60 bg-surface2/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-accent">
                    <KindIcon kind={d.kind} />
                    <span>{d.kind}</span>
                    {typeof d.confidence === "number" && (
                      <span className="text-text-muted/70">
                        · {Math.round(d.confidence)}%
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-text-muted/70">
                    {d.target_object} · {d.target_id}
                  </div>
                </div>
                <div className="mt-2 text-[15px] font-medium text-text">
                  {d.title}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-text-muted">
                  {d.body}
                </p>
                {d.rationale && (
                  <div className="mt-2 border-l-2 border-accent/40 pl-3 text-[12px] italic text-text-muted/80">
                    {d.rationale}
                  </div>
                )}

                <div className="mt-4 flex items-center justify-end gap-2">
                  {st.kind === "idle" && (
                    <>
                      <button
                        onClick={() => dismiss(d)}
                        className="flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-[12px] text-text-muted hover:bg-surface hover:text-text"
                      >
                        <X size={12} />
                        Dismiss
                      </button>
                      <button
                        onClick={() => approve(d)}
                        className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-bg hover:opacity-90"
                      >
                        <Check size={12} />
                        Approve & execute
                      </button>
                    </>
                  )}
                  {st.kind === "executing" && (
                    <span className="flex items-center gap-2 text-[12px] text-text-muted">
                      <Loader2 size={12} className="animate-spin text-accent" />
                      Writing through salesforce_crm…
                    </span>
                  )}
                  {st.kind === "done" && (
                    <span className="flex items-center gap-2 text-[12px] text-emerald-300">
                      <Check size={12} />
                      Executed
                      {st.recordId ? ` · ${st.recordId}` : ""}
                    </span>
                  )}
                  {st.kind === "error" && (
                    <div className="flex items-center gap-2 text-[12px] text-red-300">
                      <X size={12} />
                      {st.message}
                    </div>
                  )}
                </div>
              </li>
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

function KindIcon({ kind }: { kind: DraftAction["kind"] }) {
  if (kind === "email") return <Mail size={12} />;
  if (kind === "call") return <Phone size={12} />;
  if (kind === "update") return <Pencil size={12} />;
  return <ListTodo size={12} />;
}

// Best-effort extraction. /api/actions returns the assistant's text; the
// prompt instructs it to return {"status":"ok","id":"<sf record id>"} but
// Heroku Inference occasionally wraps it — parse lazily.
function extractRecordId(text: string): string | undefined {
  const parsed = tryParseJson<{ id?: string }>(text);
  return parsed?.id;
}
