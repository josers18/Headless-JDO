"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { AskDataBar, type AskDataBarRef } from "./AskDataBar";
import { AskDataTrace } from "./AskDataTrace";
import { MarkdownView } from "@/components/horizon/MarkdownView";
import { stripThinkTagsSync } from "@/lib/analyze/sanitize";
import {
  useAskDataStream,
  type AskDataTraceStep,
} from "@/lib/client/useAskDataStream";
import { useFollowUpsBus } from "./followUpsBus";
import { useSessionUsage } from "@/components/horizon/SessionUsageProvider";
import {
  ASK_DATA_FOLLOW_UP_PICK_EVENT,
  type AskDataFollowUpPickDetail,
} from "./askDataEvents";

type MessageBlock = {
  type: string;
  [key: string]: unknown;
};

type PersistedMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: MessageBlock[];
  created_at: string;
};

type LoadedState =
  | { kind: "loading" }
  | { kind: "ready"; messages: PersistedMessage[] }
  | { kind: "error"; message: string };

export function Conversation({
  threadId,
  initialTitle,
}: {
  threadId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<LoadedState>({ kind: "loading" });
  const [title, setTitle] = useState(initialTitle);
  const barRef = useRef<AskDataBarRef | null>(null);
  const stream = useAskDataStream();
  const followUpsBus = useFollowUpsBus();
  const { refresh: refreshUsage } = useSessionUsage();
  const scrollAnchor = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/ask-threads/${threadId}/messages`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setLoaded({
          kind: "error",
          message: `Couldn't load messages (${res.status})`,
        });
        return;
      }
      const data = (await res.json()) as {
        thread?: { title: string };
        messages: PersistedMessage[];
      };
      if (data.thread?.title) setTitle(data.thread.title);
      setLoaded({ kind: "ready", messages: data.messages ?? [] });
    } catch (e) {
      setLoaded({
        kind: "error",
        message: e instanceof Error ? e.message : "Load failed",
      });
    }
  }, [threadId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  // Carry-over from /ask entry state: the banker typed the first question
  // there, the entry container created a thread and dropped the question
  // into sessionStorage. Pick it up, clear the key, and submit once the
  // initial load finishes.
  useEffect(() => {
    if (loaded.kind !== "ready") return;
    if (loaded.messages.length > 0) return; // already has history
    if (stream.state !== "idle") return;
    let pending: string | null = null;
    try {
      pending = sessionStorage.getItem(`ask-data:pending:${threadId}`);
      if (pending) sessionStorage.removeItem(`ask-data:pending:${threadId}`);
    } catch {
      /* ignore */
    }
    if (pending) {
      void stream.submit(threadId, pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, threadId]);

  // Push follow-ups into the right rail whenever a turn produces them.
  useEffect(() => {
    followUpsBus.set(stream.followUps);
  }, [stream.followUps, followUpsBus]);

  // Clear follow-ups when leaving the thread (unmount).
  useEffect(() => {
    return () => followUpsBus.clear();
  }, [followUpsBus]);

  // When the server responds with a generated title, reflect it + let the
  // sidebar refresh by bumping the router — lightweight way to update
  // the ThreadList without adding a cross-component event bus here.
  useEffect(() => {
    if (stream.threadTitle) {
      setTitle(stream.threadTitle);
      router.refresh();
    }
  }, [stream.threadTitle, router]);

  // Auto-scroll to the bottom as tokens stream.
  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stream.narrative, stream.trace.length]);

  // Reload messages from the server once the assistant is persisted so
  // the thread view reflects the DB rather than relying on the streamed
  // deltas forever.
  useEffect(() => {
    if (stream.state === "done" || stream.state === "error") {
      void loadMessages();
      // Reconcile the token-spend panel — this turn's row was written
      // server-side; pull the fresh session total so the dock updates
      // without waiting for a window-focus event.
      refreshUsage();
    }
  }, [stream.state, loadMessages, refreshUsage]);

  async function handleSubmit(question: string) {
    await stream.submit(threadId, question);
  }

  // Listen for follow-up pill clicks from ContextRail. Pre-fill the bar
  // so the banker can review/edit before submitting rather than firing
  // immediately — less surprising behavior.
  useEffect(() => {
    function onPick(e: Event) {
      const detail = (e as CustomEvent<AskDataFollowUpPickDetail>).detail;
      if (!detail?.suggestion) return;
      barRef.current?.setValue(detail.suggestion);
    }
    window.addEventListener(ASK_DATA_FOLLOW_UP_PICK_EVENT, onPick);
    return () =>
      window.removeEventListener(ASK_DATA_FOLLOW_UP_PICK_EVENT, onPick);
  }, []);

  const isStreaming = stream.state === "streaming";

  return (
    <>
      <section className="mt-8 animate-fade-rise">
        <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
          Thread
        </div>
        <h1 className="mt-2 font-display text-2xl tracking-tight text-text md:text-3xl">
          {title}
        </h1>
      </section>

      <section className="mt-8 flex flex-col gap-6">
        {loaded.kind === "loading" && (
          <div className="text-[13px] text-text-muted">Loading…</div>
        )}
        {loaded.kind === "error" && (
          <div className="text-[13px] text-danger/90">{loaded.message}</div>
        )}
        {loaded.kind === "ready" &&
          loaded.messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}

        {isStreaming && (
          <LiveAssistantTurn
            narrative={stream.narrative}
            trace={stream.trace}
          />
        )}

        {stream.state === "error" && stream.error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger/90">
            {stream.error}
          </div>
        )}

        <div ref={scrollAnchor} />
      </section>

      <AskDataBar
        innerRef={barRef}
        placeholder={
          isStreaming ? "Thinking…" : "Continue this thread… (⌘K)"
        }
        disabled={isStreaming}
        onSubmit={handleSubmit}
      />
    </>
  );
}

function MessageRow({ message }: { message: PersistedMessage }) {
  const text = flattenText(message.content);
  if (!text && message.role !== "assistant") return null;

  if (message.role === "user") {
    return (
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-surface-raised px-4 py-2.5 text-[14px] text-text">
        {text}
      </div>
    );
  }

  const toolBlocks = message.content.filter(
    (b) => b.type === "tool_use" || b.type === "tool_result"
  );

  // Strip any persisted `<think>…</think>` blocks from older threads
  // written before the streaming sanitizer landed. Tags from a live
  // turn are already stripped server-side.
  const cleanText = stripThinkTagsSync(text);

  return (
    <div className="max-w-full">
      {cleanText && (
        <div className="max-w-full text-[14px] leading-relaxed text-text">
          <MarkdownView source={cleanText} />
        </div>
      )}
      {toolBlocks.length > 0 && (
        <div className="mt-3">
          <AskDataTrace
            steps={toolBlocksToTrace(toolBlocks)}
            defaultOpen={false}
          />
        </div>
      )}
    </div>
  );
}

function LiveAssistantTurn({
  narrative,
  trace,
}: {
  narrative: string;
  trace: AskDataTraceStep[];
}) {
  return (
    <div className="max-w-full">
      {trace.length > 0 && (
        <div className="mb-3">
          <AskDataTrace steps={trace} defaultOpen={false} />
        </div>
      )}
      <div className="max-w-full text-[14px] leading-relaxed text-text">
        <MarkdownView source={narrative} />
        <span
          className={cn(
            "ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-accent"
          )}
        />
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function flattenText(blocks: MessageBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string") {
      parts.push(b.text as string);
    }
  }
  return parts.join("\n").trim();
}

function toolBlocksToTrace(blocks: MessageBlock[]): AskDataTraceStep[] {
  // Pair use+result blocks by tool_use_id ordering.
  const uses = new Map<string, MessageBlock>();
  const results = new Map<string, MessageBlock>();
  for (const b of blocks) {
    if (b.type === "tool_use" && typeof b.id === "string") uses.set(b.id, b);
    if (b.type === "tool_result" && typeof b.tool_use_id === "string")
      results.set(b.tool_use_id as string, b);
  }
  const out: AskDataTraceStep[] = [];
  for (const [id, use] of uses) {
    const result = results.get(id);
    const name = (use.name as string) ?? "unknown";
    const input = use.input ?? {};
    out.push({
      callId: id,
      name,
      input,
      status: result
        ? (result.is_error ? "error" : "done")
        : "running",
      preview:
        result && typeof result.content === "string"
          ? (result.content as string).slice(0, 200)
          : undefined,
    });
  }
  return out;
}
