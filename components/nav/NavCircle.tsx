"use client";

import type { ReactNode } from "react";

// Rail destinations — narrow union so we can validate hard-nav targets.
type RailHref = "/" | "/ask" | "/analyze";

type NavCircleProps = {
  href: RailHref;
  label: string;
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
};

export function NavCircle({
  href,
  label,
  active,
  disabled = false,
  children,
}: NavCircleProps) {
  const base =
    "group relative flex h-10 w-10 items-center justify-center rounded-full border text-xs font-medium transition-[background-color,border-color,color] duration-150";
  const state = active
    ? "border-accent bg-accent text-bg shadow-[0_0_0_3px_rgba(91,141,239,0.18)]"
    : disabled
      ? "border-border-soft/60 text-text-muted/40"
      : "border-border-soft text-text-muted hover:border-accent/60 hover:text-text";

  const body = (
    <>
      <span aria-hidden>{children}</span>
      <span
        className="pointer-events-none absolute left-[calc(100%+10px)] top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-border-soft bg-surface-2 px-2 py-1 text-[11px] text-text opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        role="tooltip"
      >
        {label}
      </span>
    </>
  );

  if (disabled) {
    return (
      <span
        className={`${base} ${state} cursor-not-allowed`}
        aria-disabled="true"
        aria-label={label}
      >
        {body}
      </span>
    );
  }

  // Hard-navigate with a plain <a> instead of next/link's soft-nav.
  // Next's client router queues a nav behind the in-flight render, so
  // clicking "Ask My Data" during Today's 8 serial section fetches
  // feels stuck — the URL won't swap until Today either finishes or
  // suspends. A plain <a> hands the navigation to the browser, which
  // cancels whatever's rendering and fetches the destination fresh.
  //
  // Cost: rail re-renders on each nav (~0ms, client-only component).
  // Win: navigation is immediate even mid-render.
  return (
    <a
      href={href}
      className={base + " " + state}
      aria-current={active ? "page" : undefined}
      aria-label={label}
    >
      {body}
    </a>
  );
}
