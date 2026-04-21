"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronRight,
  MoreHorizontal,
  Phone,
  Mail,
  ListTodo,
  ClipboardCheck,
  Sparkles,
  Clock,
  X as XIcon,
  MessageSquare,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { dispatchAction, type HorizonAction } from "@/lib/client/actions/registry";

export interface ActionSpec {
  /** What the user sees on the button. */
  label: string;
  /** What actually runs when clicked. */
  action: HorizonAction;
  /** Optional icon; we'll infer from action.kind if omitted. */
  icon?: LucideIcon;
  /** Disables the button without hiding it. */
  disabled?: boolean;
  /** Hover hint. */
  title?: string;
  /** Marks this as the "autonomy" (Do-this-for-me) action — amber tint. */
  autonomy?: boolean;
}

export interface ActionRowProps {
  /** Rendered to the left of the buttons — any content. */
  children: ReactNode;
  /** The big blue button. */
  primary?: ActionSpec;
  /** The quiet neighbor button. */
  secondary?: ActionSpec;
  /** Extra actions hidden behind the "…" menu. */
  overflow?: ActionSpec[];
  /** Row is clickable itself (usually to open the Client Detail Sheet). */
  onRowClick?: () => void;
  /** Dense variant for Priority Queue rows / Signal rows. */
  density?: "comfortable" | "compact";
  className?: string;
}

function iconFor(a: HorizonAction): LucideIcon {
  switch (a.kind) {
    case "ask":
    case "investigate":
      return MessageSquare;
    case "open_client":
      return ChevronRight;
    case "lightning":
      return ExternalLink;
    case "prep":
      return Sparkles;
    case "draft_email":
      return Mail;
    case "draft_call":
      return Phone;
    case "create_task":
      return ListTodo;
    case "snooze":
      return Clock;
    case "dismiss":
      return XIcon;
    case "do_for_me":
      return Sparkles;
    case "execute":
      return ClipboardCheck;
    case "refresh":
      return ClipboardCheck;
  }
}

export function ActionRow({
  children,
  primary,
  secondary,
  overflow,
  onRowClick,
  density = "comfortable",
  className,
}: ActionRowProps) {
  const interactive = Boolean(onRowClick);
  const padY = density === "compact" ? "py-3" : "py-4";

  return (
    <div
      className={cn(
        "group relative flex items-center gap-4 rounded-lg border border-transparent px-4 transition-colors duration-med ease-out hover:border-border-soft hover:bg-surface/60",
        padY,
        interactive &&
          "cursor-pointer focus-within:border-accent/40 focus-within:bg-surface/70",
        className
      )}
      onClick={(e) => {
        if (!interactive) return;
        // Don't steal clicks that were meant for a button inside.
        const t = e.target as HTMLElement;
        if (t.closest("[data-actionrow-noclick]")) return;
        onRowClick?.();
      }}
      onKeyDown={(e) => {
        if (!interactive) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onRowClick?.();
        }
      }}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      <div className="min-w-0 flex-1">{children}</div>

      <div
        className="flex shrink-0 items-center gap-1.5"
        data-actionrow-noclick
      >
        {secondary && <ActionButton spec={secondary} variant="ghost" />}
        {primary && <ActionButton spec={primary} variant="solid" />}
        {overflow && overflow.length > 0 && (
          <OverflowMenu items={overflow} />
        )}
      </div>
    </div>
  );
}

function ActionButton({
  spec,
  variant,
}: {
  spec: ActionSpec;
  variant: "solid" | "ghost";
}) {
  const Icon = spec.icon ?? iconFor(spec.action);
  const base =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] transition disabled:opacity-40 disabled:cursor-not-allowed";
  const style =
    variant === "solid"
      ? spec.autonomy
        ? "bg-amber-400/90 text-bg hover:brightness-110 shadow-[0_0_14px_rgba(245,165,36,0.35)]"
        : "bg-accent-sheen text-bg shadow-glow hover:brightness-110"
      : "border border-border-soft text-text hover:border-border hover:bg-surface/80";

  return (
    <button
      type="button"
      disabled={spec.disabled}
      title={spec.title}
      onClick={(e) => {
        e.stopPropagation();
        void dispatchAction(spec.action);
      }}
      className={cn(base, style)}
    >
      <Icon size={13} className="shrink-0 opacity-90" />
      <span className="whitespace-nowrap">{spec.label}</span>
    </button>
  );
}

function OverflowMenu({ items }: { items: ActionSpec[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex size-8 items-center justify-center rounded-lg text-text-muted transition hover:bg-surface/70 hover:text-text"
        title="More actions"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-50 w-[220px] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_24px_60px_-30px_rgba(0,0,0,0.6)]"
        >
          {items.map((spec, i) => {
            const Icon = spec.icon ?? iconFor(spec.action);
            return (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={spec.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  void dispatchAction(spec.action);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[12px] text-text transition disabled:opacity-40",
                  "hover:bg-surface2",
                  spec.autonomy && "text-amber-200"
                )}
              >
                <Icon size={13} className="shrink-0 opacity-80" />
                <span className="flex-1">{spec.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
