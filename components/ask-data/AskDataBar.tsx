"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, Mic } from "lucide-react";
import { useSpeechInput } from "@/lib/client/useSpeechInput";
import { cn } from "@/lib/utils";

export type AskDataBarRef = {
  /** Populate the textbox (used by starter-pill clicks and future flows). */
  setValue: (next: string) => void;
  /** Push focus into the input. */
  focus: () => void;
};

export type AskDataBarProps = {
  /**
   * Called when the banker submits (Enter or submit-arrow). Wired in T1-3
   * when /api/ask-data lands. For T1-1 the default prevents submission
   * and logs a console note — the pill is visual chrome only until T1-3.
   */
  onSubmit?: (question: string) => void;
  /** Placeholder text. Matches Today AskBar's language by default. */
  placeholder?: string;
  /** Disable the submit arrow even when the input has content. */
  disabled?: boolean;
  /** Ref escape hatch for parent components (e.g. starter pills). */
  innerRef?: React.RefObject<AskDataBarRef | null>;
  /**
   * Positioning strategy. `"viewport"` = viewport-wide fixed-bottom pill
   * (Today AskBar treatment; what we shipped in T1-1). `"column"` = stick
   * to the bottom of the main column only, used in the /ask 3-column
   * workspace so the pill respects the sidebar + right rail (T1-2,
   * Q-T1-2-b = B). Defaults to `"column"` — T1-1's call site passed no
   * value, so we flip the default and let the old behavior opt in.
   */
  position?: "viewport" | "column";
};

/**
 * Ask My Data input pill — visual chrome of Today's AskBar (bottom-center,
 * focus glow, mic + submit arrow), with Today-specific plumbing removed.
 *
 * What's carried from AskBar (Layer 1, visual chrome):
 *  - Fixed bottom-center layout (`fixed inset-x-0 ... bottom-[...]`)
 *  - Max-width 760px pill with `bg-surface-raised/95` + `shadow-ask-lift`
 *  - Focus ring + accent gradient sheen on top edge
 *  - Mic button (Web Speech API via useSpeechInput) with listening-state glow
 *  - Submit arrow (ArrowUp) with accent sheen on value.trim()
 *  - ⌘K keyboard focus shortcut
 *
 * What's intentionally omitted (Today-specific; see T1-1 decision notes):
 *  - HORIZON_FOCUS_CLIENT / HORIZON_ASK_SUBMIT / HORIZON_PREP_SUBMIT events
 *  - PrepBriefingPanel, draft-actions, follow-up pills, inference badge
 *  - The floating conversation panel above the pill (arrives in T1-3 with
 *    a separate AskDataConversation component)
 *  - Streaming cancel state / Stop button — no stream wired yet in T1-1
 *
 * In T1-3 we add a parent component that composes AskDataBar with a
 * conversation panel; this file stays focused on the pill.
 */
export function AskDataBar(props: AskDataBarProps) {
  const {
    onSubmit,
    placeholder = "Ask about your book… (⌘K)",
    disabled = false,
    innerRef,
    position = "column",
  } = props;

  const [focus, setFocus] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const speech = useSpeechInput();

  const doFocus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useImperativeHandle(
    innerRef as React.RefObject<AskDataBarRef | null>,
    () => ({
      setValue: (next: string) => {
        setValue(next);
        // Next tick — input has to rerender before we move the caret.
        requestAnimationFrame(doFocus);
      },
      focus: doFocus,
    }),
    [doFocus]
  );

  // ⌘K / Ctrl+K → focus the pill. Mirrors AskBar, scoped to this component
  // so it does not conflict with Today's AskBar on `/` (this bar is only
  // mounted on `/ask`, so there is no collision).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        // Already in an input field — let the browser handle it.
        return;
      }
      e.preventDefault();
      doFocus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFocus]);

  // Stream transcript into the input while the user dictates.
  useEffect(() => {
    if (!speech.supported) return;
    const combined = [speech.transcript, speech.interim].filter(Boolean).join(" ");
    if (combined) setValue(combined);
  }, [speech.transcript, speech.interim, speech.supported]);

  function toggleMic() {
    if (speech.listening) speech.stop();
    else speech.start();
  }

  function submit() {
    const q = value.trim();
    if (!q || disabled) return;
    if (onSubmit) {
      onSubmit(q);
      return;
    }
    // T1-1 default — no /api/ask-data yet. Surface that the submit worked
    // mechanically but the backend lands in T1-3.
    // eslint-disable-next-line no-console
    console.info("[ask-data] T1-1: submit no-op pending T1-3 wiring:", q);
  }

  // When mounted inside the AskWorkspace grid (`position = "column"`), the
  // pill uses `sticky bottom-0` so it pins to the bottom of the main
  // column only, leaving the sidebar and right rail undisturbed (Q-T1-2-b
  // = B). `position = "viewport"` falls back to the Today AskBar
  // treatment: a `fixed inset-x-0` floating pill.
  const outerClass =
    position === "viewport"
      ? "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
      : "pointer-events-none sticky z-30 mt-auto flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] bottom-[max(1.25rem,env(safe-area-inset-bottom,0px))]";

  return (
    <div className={outerClass}>
      <div className="pointer-events-auto flex w-full max-w-[760px] flex-col gap-3">
        {speech.error && (
          <div className="mx-auto max-w-prose rounded-md border border-danger/30 bg-danger/10 px-3 py-1.5 text-[11px] text-danger/90">
            Voice input: {speech.error}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className={cn(
            "group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-ask-lift backdrop-blur-md transition-all duration-med ease-out",
            focus ? "border-accent/50 shadow-glow" : "hover:border-border",
            speech.listening && "border-accent/60 shadow-glow"
          )}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 -top-px h-px bg-accent-sheen opacity-0 transition-opacity duration-med",
              (focus || speech.listening) && "opacity-80"
            )}
            aria-hidden
          />

          {speech.supported && (
            <>
              <button
                type="button"
                onClick={toggleMic}
                className={cn(
                  "relative flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl transition duration-fast md:h-9 md:w-9 md:min-h-0 md:min-w-0",
                  speech.listening
                    ? "bg-accent text-bg shadow-glow"
                    : "bg-surface2 text-text-muted hover:text-text"
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
              {speech.listening && (
                <div className="hidden shrink-0 max-md:flex">
                  <VoiceWaveform />
                </div>
              )}
            </>
          )}

          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocus(true)}
            onBlur={() => setFocus(false)}
            placeholder={speech.listening ? "Listening…" : placeholder}
            className="relative min-h-[44px] flex-1 bg-transparent py-2 text-[15px] text-text placeholder:text-text-muted focus:outline-none md:min-h-0 md:py-0"
            aria-label="Ask My Data"
          />

          <button
            type="submit"
            disabled={!value.trim() || disabled}
            className={cn(
              "relative flex min-h-[44px] min-w-[44px] items-center justify-center overflow-hidden rounded-xl transition duration-med md:h-9 md:w-9 md:min-h-0 md:min-w-0",
              value.trim() && !disabled
                ? "bg-accent-sheen text-bg shadow-glow"
                : "bg-surface2 text-text-muted"
            )}
            aria-label="Send"
          >
            <ArrowUp size={16} strokeWidth={2.4} />
            {value.trim() && !disabled && (
              <span className="sheen-overlay" aria-hidden />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

// Private copy of Today AskBar's VoiceWaveform. Kept local rather than
// refactored out because CLAUDE.md §T0 "additive, not refactoring" —
// touching AskBar.tsx to export VoiceWaveform would ripple into Today's
// rendered HTML signature and we want Today unchanged.
function VoiceWaveform() {
  return (
    <div className="flex h-6 items-end gap-0.5 px-0.5" aria-hidden>
      {[12, 18, 14, 20].map((h, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-accent/90 animate-pulse"
          style={{ height: h, animationDelay: `${i * 120}ms` }}
        />
      ))}
    </div>
  );
}
