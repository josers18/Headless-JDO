"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Home, MessageSquare, BarChart3 } from "lucide-react";
import { NavCircle } from "./NavCircle";

type RailProps = {
  signedIn: boolean;
};

// The rail is full-viewport-height, 64px wide, fixed to the left edge.
// URL-invisible route group `(banker)` shares this shell across Today,
// Ask My Data, and Analyze. Signed-out state keeps the shell visible
// (per Q-T0-1-d Option A) with Ask / Analyze disabled until auth.
export function LeftRail({ signedIn }: RailProps) {
  const pathname = usePathname();

  // Active route is just the URL — route groups are URL-invisible.
  const activeRoute: "today" | "ask" | "analyze" = pathname.startsWith("/ask")
    ? "ask"
    : pathname.startsWith("/analyze")
      ? "analyze"
      : "today";

  useEffect(() => {
    // Per Q-T0-1-b Option A: shortcuts live on the rail itself, not
    // a separate global provider. Cmd+1 / Cmd+2 / Cmd+3 route between
    // sections; disabled destinations are skipped when signed out.
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.altKey || e.shiftKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        target?.isContentEditable
      ) {
        return;
      }

      let dest: "/" | "/ask" | "/analyze" | null = null;
      if (e.key === "1") dest = "/";
      else if (e.key === "2") dest = signedIn ? "/ask" : null;
      else if (e.key === "3") dest = signedIn ? "/analyze" : null;

      if (dest) {
        e.preventDefault();
        // Hard-navigate so the shortcut feels instant even mid-render.
        // See NavCircle.tsx for the rationale.
        window.location.assign(dest);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [signedIn]);

  return (
    <nav
      aria-label="Horizon sections"
      className="fixed left-0 top-0 z-50 flex h-dvh w-16 flex-col items-center border-r border-border-soft/60 bg-bg/80 py-4 backdrop-blur-md supports-[backdrop-filter]:bg-bg/60"
    >
      {/* Cumulus avatar (Q-T0-1-a Option A: reuse HorizonMark's ring-mark) */}
      <div
        className="flex h-10 w-10 items-center justify-center"
        aria-hidden
      >
        <span className="relative inline-flex h-8 w-8 items-center justify-center">
          <span
            className="pointer-events-none absolute inset-0 rounded-full bg-accent/25 blur-[10px] animate-glow-pulse"
            aria-hidden
          />
          <svg
            width="24"
            height="24"
            viewBox="0 0 22 22"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="relative z-[1]"
          >
            <defs>
              <linearGradient id="hz-rail-ring" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#5B8DEF" />
                <stop offset="100%" stopColor="#A78BFA" />
              </linearGradient>
            </defs>
            <circle
              cx="11"
              cy="11"
              r="10"
              stroke="url(#hz-rail-ring)"
              strokeWidth="1.25"
            />
            <path
              d="M2 12.5 C 6 10, 10 10, 14 12 S 20 14, 20 14"
              stroke="url(#hz-rail-ring)"
              strokeWidth="1.25"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </span>
      </div>

      <div className="mt-8 flex flex-col items-center gap-3">
        <NavCircle href="/" label="Today — ⌘1" active={activeRoute === "today"}>
          <Home size={16} strokeWidth={1.75} aria-hidden />
        </NavCircle>
        <NavCircle
          href="/ask"
          label={
            signedIn ? "Ask My Data — ⌘2" : "Ask My Data (sign in required)"
          }
          active={activeRoute === "ask"}
          disabled={!signedIn}
        >
          <MessageSquare size={16} strokeWidth={1.75} aria-hidden />
        </NavCircle>
        <NavCircle
          href="/analyze"
          label={
            signedIn ? "Analyze — ⌘3" : "Analyze (sign in required)"
          }
          active={activeRoute === "analyze"}
          disabled={!signedIn}
        >
          <BarChart3 size={16} strokeWidth={1.75} aria-hidden />
        </NavCircle>
      </div>

      <div className="flex-1" />

      {/* Bottom-of-rail controls deferred to T0-2 per Q-T0-1-c Option B —
          UserMenu and ThemeSwitcher still live in the Today header for
          this task so we hold "zero visual regression" on /. */}
    </nav>
  );
}
