"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { useSpeechInput } from "@/lib/client/useSpeechInput";
import { ReasoningTrail } from "./ReasoningTrail";

export function AskBar() {
  const [focus, setFocus] = useState(false);
  const [value, setValue] = useState("");
  const [lastQuestion, setLastQuestion] = useState("");
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
    await start("/api/ask", { q });
  }

  function toggleMic() {
    if (speech.listening) speech.stop();
    else speech.start();
  }

  const showPanel = Boolean(
    lastQuestion && (narrative || steps.length > 0 || error || state === "streaming")
  );

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-[720px] flex-col gap-3">
        {showPanel && (
          <div className="animate-fade-rise rounded-xl border border-border/60 bg-surface/95 px-5 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">
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
            <div className="mt-1 text-[14px] text-text">{lastQuestion}</div>
            {error && (
              <div className="mt-3 rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-[13px] text-red-200">
                {error}
              </div>
            )}
            {narrative && (
              <div className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed text-text">
                {narrative}
                {state === "streaming" && (
                  <span className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-accent" />
                )}
              </div>
            )}
            {!narrative && state === "streaming" && steps.length === 0 && (
              <div className="mt-4 h-4 w-32 rounded shimmer" />
            )}
            {steps.length > 0 && (
              <div className="mt-4">
                <ReasoningTrail steps={steps} defaultOpen={false} />
              </div>
            )}
          </div>
        )}

        {speech.error && (
          <div className="mx-auto max-w-prose rounded-md border border-red-400/30 bg-red-400/10 px-3 py-1.5 text-[11px] text-red-200">
            Voice input: {speech.error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className={cn(
            "flex items-center gap-3 rounded-xl border border-border bg-surface/90 px-4 py-3 backdrop-blur transition duration-med ease-out",
            focus && "ring-accent",
            speech.listening && "border-accent/60 ring-1 ring-accent/40"
          )}
        >
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
            className="flex-1 bg-transparent text-[15px] text-text placeholder:text-text-muted focus:outline-none"
            aria-label="Ask Horizon"
          />
          {speech.supported && (
            <button
              type="button"
              onClick={toggleMic}
              disabled={state === "streaming"}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition duration-fast",
                speech.listening
                  ? "bg-accent text-bg animate-pulse"
                  : "bg-surface2 text-text-muted hover:text-text",
                state === "streaming" && "opacity-40"
              )}
              aria-label={speech.listening ? "Stop dictating" : "Dictate"}
              title={speech.listening ? "Stop dictating" : "Dictate"}
            >
              <Mic size={14} />
            </button>
          )}
          {state === "streaming" ? (
            <button
              type="button"
              onClick={cancel}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-surface2 text-text-muted hover:text-text"
              aria-label="Stop"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!value.trim()}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md transition duration-fast",
                value.trim()
                  ? "bg-accent text-bg"
                  : "bg-surface2 text-text-muted"
              )}
              aria-label="Send"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
