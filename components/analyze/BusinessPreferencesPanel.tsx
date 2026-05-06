"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/**
 * Collapsible "Business preferences" panel on /analyze/[modelId].
 * Defaults to collapsed so the SDM author's # prefs guidance
 * (sometimes 20+ lines) doesn't dominate the header space; the
 * banker can expand when they want to see what rules the SDM is
 * authored against.
 */
export function BusinessPreferencesPanel({ value }: { value: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-4 max-w-2xl rounded-lg border border-border-soft/60 bg-surface/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted transition hover:text-text"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Business preferences
        </span>
      </button>
      {open && (
        <pre className="whitespace-pre-wrap border-t border-border-soft/40 px-4 py-3 text-[12px] leading-relaxed text-text-muted/90">
          {value}
        </pre>
      )}
    </div>
  );
}
