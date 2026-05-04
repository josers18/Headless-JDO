"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AskDataBar, type AskDataBarRef } from "./AskDataBar";
import { StarterPrompts } from "./StarterPrompts";

/**
 * Entry-state container for /ask — greets the banker, surfaces 6 starter
 * prompts, and hosts the fixed-bottom AskDataBar. On submit we create a
 * thread via /api/ask-threads and navigate to /ask/[id] with the question
 * carried via sessionStorage so Conversation can auto-submit the first
 * turn without a round-trip through the URL.
 */
export function AskDataEntry() {
  const router = useRouter();
  const barRef = useRef<AskDataBarRef | null>(null);
  const [busy, setBusy] = useState(false);

  function handlePickPrompt(prompt: string) {
    barRef.current?.setValue(prompt);
  }

  async function handleSubmit(question: string) {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ask-threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New conversation" }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { thread: { id: string } };
      // Hand the initial question off to the Conversation component. The
      // pending-question key is thread-scoped so leaving this tab mid-flow
      // doesn't accidentally replay the question later.
      try {
        sessionStorage.setItem(
          `ask-data:pending:${data.thread.id}`,
          question
        );
      } catch {
        /* storage disabled — Conversation just won't auto-fire */
      }
      router.push(`/ask/${data.thread.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="mt-16 animate-fade-rise">
        <h1 className="font-display text-3xl tracking-tight text-text md:text-4xl">
          What would you like to know about your book?
        </h1>
        <p className="mt-3 max-w-xl text-[14px] text-text-muted">
          Ask anything about your clients — behaviors, life events, segments,
          pipeline, held-aways. Pick a starter below or type your own.
        </p>
        <div className="mt-8 animate-fade-rise stagger-1">
          <StarterPrompts onPick={handlePickPrompt} />
        </div>
      </section>

      <AskDataBar
        innerRef={barRef}
        onSubmit={handleSubmit}
        disabled={busy}
      />
    </>
  );
}
