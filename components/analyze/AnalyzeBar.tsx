"use client";

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import { cn } from "@/lib/utils";

export type AnalyzeBarRef = {
  setValue: (next: string) => void;
  focus: () => void;
};

export type AnalyzeBarProps = {
  onSubmit: (question: string) => void;
  onCancel?: () => void;
  placeholder?: string;
  disabled?: boolean;
  streaming?: boolean;
  innerRef?: React.RefObject<AnalyzeBarRef | null>;
};

/**
 * Ask bar for Analyze. Inline within the main column (not fixed-bottom
 * like Today's AskBar) so the sidebar and the slide-in metric drawer
 * (T2-5) don't overlap it. Narrow vocabulary: just input + submit +
 * cancel — voice input and inference-badge trail are deferred.
 */
export function AnalyzeBar({
  onSubmit,
  onCancel,
  placeholder = "Ask this model a question…",
  disabled = false,
  streaming = false,
  innerRef,
}: AnalyzeBarProps) {
  const [focus, setFocus] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const doFocus = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useImperativeHandle(
    innerRef as React.RefObject<AnalyzeBarRef | null>,
    () => ({
      setValue: (next: string) => {
        setValue(next);
        requestAnimationFrame(doFocus);
      },
      focus: doFocus,
    }),
    [doFocus]
  );

  // ⌘K focus the input. Scoped to Analyze — this pill only mounts on
  // /analyze/[modelId].
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      )
        return;
      e.preventDefault();
      doFocus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doFocus]);

  function submit() {
    const q = value.trim();
    if (!q || disabled || streaming) return;
    onSubmit(q);
    setValue("");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className={cn(
        "group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-surface-raised/95 px-4 py-3 shadow-ask-lift backdrop-blur-md transition-all duration-med ease-out",
        focus ? "border-accent/50 shadow-glow" : "hover:border-border"
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 -top-px h-px bg-accent-sheen opacity-0 transition-opacity duration-med",
          focus && "opacity-80"
        )}
        aria-hidden
      />

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        placeholder={streaming ? "Analyzing…" : placeholder}
        className="relative min-h-[44px] flex-1 bg-transparent py-2 text-[15px] text-text placeholder:text-text-muted focus:outline-none md:min-h-0 md:py-0"
        aria-label="Ask this model"
        disabled={disabled || streaming}
      />

      {streaming && onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl bg-surface2 text-text-muted transition hover:text-text md:h-9 md:w-9 md:min-h-0 md:min-w-0"
          aria-label="Stop"
        >
          <Square size={14} />
        </button>
      ) : (
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
        </button>
      )}
    </form>
  );
}
