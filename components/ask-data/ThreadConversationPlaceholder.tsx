"use client";

import { useRef } from "react";
import { AskDataBar, type AskDataBarRef } from "./AskDataBar";

/**
 * Placeholder rendered inside AskWorkspace for a persisted thread in T1-2.
 * Shows the thread title and a "pick up where you left off" beat. The
 * real Conversation component (streaming messages, tool-use trail,
 * follow-ups) replaces this file in T1-3.
 */
export function ThreadConversationPlaceholder({
  threadId,
  title,
}: {
  threadId: string;
  title: string;
}) {
  const barRef = useRef<AskDataBarRef | null>(null);

  return (
    <>
      <section className="mt-8 animate-fade-rise">
        <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
          Thread
        </div>
        <h1 className="mt-2 font-display text-2xl tracking-tight text-text md:text-3xl">
          {title}
        </h1>
        <p className="mt-3 max-w-lg text-[13px] text-text-muted">
          Continue the conversation — messages render here in the next
          increment. Thread id:{" "}
          <code className="rounded bg-surface2 px-1.5 py-0.5 text-[12px]">
            {threadId}
          </code>
        </p>
      </section>

      <AskDataBar
        innerRef={barRef}
        placeholder="Continue this thread…"
      />
    </>
  );
}
