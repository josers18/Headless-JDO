"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  /** Optional title rendered in the drawer header. */
  title?: string;
  children: React.ReactNode;
};

/**
 * Left-anchored mobile drawer. Renders nothing at >= lg — desktop hosts the
 * same content in a sticky <aside> directly. Used by /analyze (ModelList)
 * and /ask (ThreadList) so phone bankers can pick a model / thread.
 *
 * Closes on: backdrop tap, Esc, programmatic onClose. Locks body scroll
 * while open and returns focus to the trigger element on close.
 */
export function MobileDrawer({
  open,
  onClose,
  ariaLabel,
  title,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Capture the element that triggered the open so we can restore focus
  // when the drawer closes — important for keyboard users.
  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement | null;
      // Defer focus to next tick so the slide-in animation has the panel
      // mounted before we move focus into it.
      requestAnimationFrame(() => {
        panelRef.current?.focus();
      });
    } else if (triggerRef.current) {
      triggerRef.current.focus?.();
      triggerRef.current = null;
    }
  }, [open]);

  // Esc closes; body scroll lock while open.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-start bg-black/60 backdrop-blur-[4px] animate-fade-in lg:hidden"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative flex h-full w-[min(86vw,360px)] flex-col border-r border-border-soft bg-surface shadow-[0_28px_60px_-30px_rgba(0,0,0,0.75)] outline-none animate-slide-in-left",
          "pl-[env(safe-area-inset-left,0px)] pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]"
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-soft/60 px-4 py-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
            {title ?? ariaLabel}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted transition hover:bg-surface2 hover:text-text"
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
