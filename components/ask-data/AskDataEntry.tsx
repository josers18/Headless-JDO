"use client";

import { useRef } from "react";
import { AskDataBar, type AskDataBarRef } from "./AskDataBar";
import { StarterPrompts } from "./StarterPrompts";

/**
 * Entry-state container for /ask — greets the banker, surfaces 6 starter
 * prompts, and hosts the fixed-bottom AskDataBar. No MCP / no streaming in
 * T1-1; pill clicks pre-fill the bar so the interaction reads right.
 */
export function AskDataEntry() {
  const barRef = useRef<AskDataBarRef | null>(null);

  function handlePickPrompt(prompt: string) {
    barRef.current?.setValue(prompt);
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

      <AskDataBar innerRef={barRef} />
    </>
  );
}
