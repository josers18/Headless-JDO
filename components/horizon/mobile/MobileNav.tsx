"use client";

import { usePathname } from "next/navigation";
import { BarChart3, Home, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  signedIn: boolean;
};

/**
 * Floating section-navigation pill for phones / tablets in portrait
 * (lg:hidden). Mirrors the desktop LeftRail's three sections so mobile
 * bankers have a primary nav surface — the rail itself is hidden below
 * lg to reclaim the 64px gutter.
 *
 * Bottom offset clears the AskBar above it. z-30 sits below the AskBar
 * response panel (z-40) so streaming answers cover the nav, not the
 * other way around.
 */
export function MobileNav({ signedIn }: Props) {
  const pathname = usePathname();
  const activeRoute: "today" | "ask" | "analyze" = pathname.startsWith("/ask")
    ? "ask"
    : pathname.startsWith("/analyze")
      ? "analyze"
      : "today";

  return (
    <nav
      className="fixed left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-border-soft/80 bg-surface/95 px-1.5 py-1.5 shadow-[0_12px_40px_-18px_rgba(0,0,0,0.65)] backdrop-blur-md lg:hidden"
      style={{
        bottom: "calc(5.75rem + env(safe-area-inset-bottom, 0px))",
      }}
      aria-label="Section navigation"
    >
      <NavButton
        href="/"
        label="Today"
        active={activeRoute === "today"}
        disabled={false}
      >
        <Home size={18} strokeWidth={1.8} aria-hidden />
      </NavButton>
      <NavButton
        href="/ask"
        label={signedIn ? "Ask My Data" : "Ask My Data (sign in required)"}
        active={activeRoute === "ask"}
        disabled={!signedIn}
      >
        <MessageSquare size={18} strokeWidth={1.8} aria-hidden />
      </NavButton>
      <NavButton
        href="/analyze"
        label={signedIn ? "Analyze" : "Analyze (sign in required)"}
        active={activeRoute === "analyze"}
        disabled={!signedIn}
      >
        <BarChart3 size={18} strokeWidth={1.8} aria-hidden />
      </NavButton>
    </nav>
  );
}

function NavButton({
  href,
  label,
  active,
  disabled,
  children,
}: {
  href: string;
  label: string;
  active: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition",
    active && "bg-accent/15 text-accent",
    !active && !disabled && "text-text-muted hover:bg-surface2 hover:text-text",
    disabled && "text-text-muted/40"
  );
  if (disabled) {
    return (
      <button
        type="button"
        disabled
        aria-label={label}
        title={label}
        className={className}
      >
        {children}
      </button>
    );
  }
  return (
    <a
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      title={label}
      className={className}
    >
      {children}
    </a>
  );
}
