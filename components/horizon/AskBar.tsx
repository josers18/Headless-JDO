"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Check,
  Loader2,
  Mail,
  Mic,
  Pencil,
  Phone,
  ListTodo,
  Square,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpeechInput } from "@/lib/client/useSpeechInput";
import { ReasoningTrail } from "./ReasoningTrail";
import { sanitizeNarrative } from "@/lib/client/sanitizeNarrative";
import { extractActions } from "@/lib/client/extractActions";
import { MarkdownView } from "./MarkdownView";
import type { DraftAction } from "@/types/horizon";

// The Ask bar is pinned to the bottom of every page. It has two jobs:
//  1) Receive banker questions and stream the answer back inline above the
//     input.
//  2) Project "intelligent activity" when idle — the accent gradient and
//     the ambient glow reinforce that this is not just a chat box.
export function AskBar() {
  const [focus, setFocus] = useState(false);
  const [value, setValue] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
  const [actionStatus, setActionStatus] = useState<
    Record<string, InlineActionStatus>
  >({});
  const inputRef = useRef<HTMLInputElement>(null);
  const { narrative, steps, state, error, start, cancel, reset } =
    useAgentStream();
  const speech = useSpeechInput();

  // Pipe live dictation into the input. `interim` is the word-in-progress;
  // `transcript` is the finalized text. Concatenating gives the banker
  // instant feedback without duplicating already-committed words.
  useEffect(() => {
    if (!speech.listening) return;
    const merged = [speech.transcript, speech.interim]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (merged) setValue(merged);
  }, [speech.listening, speech.transcript, speech.interim]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === "Escape" && state !== "streaming") {
        reset();
        setValue("");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, reset]);

  async function submit() {
    const q = value.trim();
    if (!q || state === "streaming") return;
    if (speech.listening) speech.stop();
    setLastQuestion(q);
    setValue("");
    setActionStatus({});
    await start("/api/ask", { q });
  }

  function toggleMic() {
    if (speech.listening) speech.stop();
    else speech.start();
  }

  // Defense-in-depth: even though the system prompt tells the model not
  // to echo raw tool output, occasionally it streams HTML 403 bodies or
  // stack traces into its prose. We scrub those before display.
  const cleanNarrative = useMemo(() => sanitizeNarrative(narrative), [narrative]);

  // Split the cleaned narrative into prose (markdown for display) and
  // parsed DraftAction[] (rendered as approve chips below).
  const { prose, actions } = useMemo(
    () => extractActions(cleanNarrative),
    [cleanNarrative]
  );

  async function approveAction(d: DraftAction) {
    setActionStatus((s) => ({ ...s, [d.id]: { kind: "executing" } }));
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
        setActionStatus((s) => ({
          ...s,
          [d.id]: {
            kind: "error",
            message: json?.error ?? `Execute failed (${res.status})`,
          },
        }));
        return;
      }
      setActionStatus((s) => ({
        ...s,
        [d.id]: { kind: "done", recordId: extractRecordId(json?.result ?? "") },
      }));
    } catch (e) {
      setActionStatus((s) => ({
        ...s,
        [d.id]: {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }

  function dismissAction(d: DraftAction) {
    setActionStatus((s) => ({ ...s, [d.id]: { kind: "dismissed" } }));
  }

  const showPanel = Boolean(
    lastQuestion &&
      (prose || actions.length > 0 || steps.length > 0 || error ||
        state === "streaming")
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-3">
        {showPanel && (
          <div className="animate-fade-rise overflow-hidden rounded-2xl border border-border-soft bg-surface/95 shadow-[0_28px_60px_-30px_rgba(0,0,0,0.7)] backdrop-blur-md">
            <div className="flex items-start justify-between gap-3 border-b border-border-soft/80 bg-black/20 px-5 py-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-text-muted">
                <span
                  className={cn(
                    "inline-block h-[6px] w-[6px] rounded-full bg-accent",
                    state === "streaming" && "animate-glow-pulse"
                  )}
                />
                Asked
              </div>
              <button
                onClick={() => {
                  reset();
                  setLastQuestion("");
                }}
                className="rounded-md p-1 text-text-muted hover:bg-surface2 hover:text-text"
                aria-label="Dismiss"
              >
                <X size={14} />
              </button>
            </div>
            <div className="px-5 py-4">
              <div className="text-[14px] font-medium text-text">{lastQuestion}</div>
              {error && (
                <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger/90">
                  {error}
                </div>
              )}
              {prose && (
                <div className="mt-3">
                  <MarkdownView source={prose} />
                  {state === "streaming" && (
                    <span className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-accent" />
                  )}
                </div>
              )}
              {!prose && state === "streaming" && steps.length === 0 && (
                <div className="mt-3 h-4 w-32 rounded shimmer" />
              )}
              {actions.length > 0 && (
                <InlineActions
                  actions={actions}
                  status={actionStatus}
                  onApprove={approveAction}
                  onDismiss={dismissAction}
                />
              )}
              {steps.length > 0 && (
                <div className="mt-4">
                  <ReasoningTrail steps={steps} defaultOpen={false} />
                </div>
              )}
            </div>
          </div>
        )}

        {speech.error && (
          <div className="mx-auto max-w-prose rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger/90">
            Voice input: {speech.error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn(
            "group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border-soft bg-surface/95 px-4 py-3 backdrop-blur-md transition-all duration-med ease-out",
            focus
              ? "border-accent/50 shadow-glow"
              : "hover:border-border",
            speech.listening && "border-accent/60 shadow-glow"
          )}
        >
          {/* Ambient accent gradient on focus — sits underneath the input. */}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -top-px h-px bg-accent-sheen opacity-0 transition-opacity duration-med",
              (focus || speech.listening) && "opacity-80"
            )}
            aria-hidden
          />

          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            placeholder={
              speech.listening
                ? "Listening…"
                : "Ask Horizon anything about your book… (⌘K)"
            }
            className="relative flex-1 bg-transparent text-[15px] text-text placeholder:text-text-muted focus:outline-none"
            aria-label="Ask Horizon"
          />
          {speech.supported && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={state === "streaming"}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-xl transition duration-fast",
                speech.listening
                  ? "bg-accent text-bg shadow-glow"
                  : "bg-surface2 text-text-muted hover:text-text",
                state === "streaming" && "opacity-40"
              )}
              aria-label={speech.listening ? "Stop dictating" : "Dictate"}
              title={speech.listening ? "Stop dictating" : "Dictate"}
            >
              <Mic size={15} />
              {speech.listening && (
                <span
                  className="pointer-events-none absolute inset-0 rounded-xl bg-accent/50 blur-md animate-glow-pulse"
                  aria-hidden
                />
              )}
            </button>
          )}
          {state === "streaming" ? (
            <button
              type="button"
              onClick={cancel}
              className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-surface2 text-text-muted transition hover:text-text"
              aria-label="Stop"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl transition duration-med",
                value.trim()
                  ? "bg-accent-sheen text-bg shadow-glow"
                  : "bg-surface2 text-text-muted"
              )}
              aria-label="Send"
            >
              <ArrowUp size={16} strokeWidth={2.4} />
              {value.trim() && (
                <span className="sheen-overlay" aria-hidden />
              )}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

// ---------- Inline action chips (compact approval UI for Ask responses) ----------

type InlineActionStatus =
  | { kind: "idle" }
  | { kind: "executing" }
  | { kind: "done"; recordId?: string }
  | { kind: "dismissed" }
  | { kind: "error"; message: string };

function InlineActions({
  actions,
  status,
  onApprove,
  onDismiss,
}: {
  actions: DraftAction[];
  status: Record<string, InlineActionStatus>;
  onApprove: (d: DraftAction) => void;
  onDismiss: (d: DraftAction) => void;
}) {
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
        <span className="inline-block h-[5px] w-[5px] rounded-full bg-accent/80" />
        Drafted actions · {actions.length}
      </div>
      <ul className="space-y-2">
        {actions.map((a) => {
          const st = status[a.id] ?? { kind: "idle" as const };
          if (st.kind === "dismissed") return null;
          return (
            <li
              key={a.id}
              className={cn(
                "group relative flex items-start gap-3 rounded-lg border border-border-soft bg-surface2/60 px-3 py-2.5 transition",
                st.kind === "done" &&
                  "border-emerald-400/40 bg-emerald-400/5",
                st.kind === "error" &&
                  "border-danger/40 bg-danger/5"
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                  a.kind === "email" && "bg-accent/15 text-accent",
                  a.kind === "call" && "bg-accent-2/15 text-accent-2",
                  a.kind === "update" && "bg-accent-warm/15 text-accent-warm",
                  a.kind === "task" && "bg-emerald-400/15 text-emerald-300"
                )}
                aria-hidden
              >
                <KindIcon kind={a.kind} />
              </span>
              <div
                className="min-w-0 flex-1"
                data-target-object={a.target_object}
                data-target-id={a.target_id}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-medium text-text">
                    {a.title}
                  </span>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-text-muted">
                    {a.kind}
                  </span>
                </div>
                {a.body && (
                  <p className="mt-1 line-clamp-2 text-[12.5px] leading-snug text-text-muted">
                    {a.body}
                  </p>
                )}
                {st.kind === "error" && (
                  <p className="mt-1 text-[11.5px] text-danger/90">
                    {st.message}
                  </p>
                )}
                {st.kind === "done" && (
                  <p className="mt-1 text-[11.5px] text-emerald-300/90">
                    Sent to Salesforce
                    {st.recordId ? ` · ${st.recordId}` : ""}
                  </p>
                )}
              </div>
              {st.kind === "idle" && (
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onApprove(a)}
                    className="relative overflow-hidden rounded-md bg-accent-sheen px-2.5 py-1 text-[11.5px] font-medium text-bg shadow-glow transition hover:brightness-110"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(a)}
                    className="rounded-md px-2 py-1 text-[11.5px] text-text-muted transition hover:bg-surface hover:text-text"
                  >
                    Dismiss
                  </button>
                </div>
              )}
              {st.kind === "executing" && (
                <div className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-text-muted">
                  <Loader2 size={12} className="animate-spin" />
                  Sending
                </div>
              )}
              {st.kind === "done" && (
                <div className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-emerald-300/90">
                  <Check size={14} />
                  Done
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KindIcon({ kind }: { kind: DraftAction["kind"] }) {
  if (kind === "email") return <Mail size={13} />;
  if (kind === "call") return <Phone size={13} />;
  if (kind === "update") return <Pencil size={13} />;
  return <ListTodo size={13} />;
}

// /api/actions returns a free-form string (usually `{"status":"ok","id":"..."}`
// but sometimes just prose). Extract a likely Salesforce Id if present.
function extractRecordId(text: string): string | undefined {
  const m = text.match(/"id"\s*:\s*"([a-zA-Z0-9]{15,18})"/);
  if (m && m[1]) return m[1];
  const bare = text.match(/\b([a-zA-Z0-9]{15,18})\b/);
  return bare && bare[1] ? bare[1] : undefined;
}
