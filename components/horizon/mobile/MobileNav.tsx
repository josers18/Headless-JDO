"use client";

import { LayoutGrid, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileNav() {
  return (
    <nav
      className={cn(
        "fixed left-1/2 z-30 flex -translate-x-1/2 gap-1 rounded-full border border-border-soft/80 bg-surface/95 px-1.5 py-1.5 shadow-[0_12px_40px_-18px_rgba(0,0,0,0.65)] backdrop-blur-md md:hidden"
      )}
      style={{
        bottom: "calc(5.75rem + env(safe-area-inset-bottom, 0px))",
      }}
      aria-label="Quick scroll"
    >
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text-muted transition hover:bg-surface2 hover:text-text"
        aria-label="Scroll to deck"
      >
        <LayoutGrid size={18} strokeWidth={1.8} />
      </button>
      <button
        type="button"
        onClick={() =>
          document
            .querySelector("[data-horizon-section=\"signals\"]")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-text-muted transition hover:bg-surface2 hover:text-text"
        aria-label="Scroll to signals"
      >
        <Radio size={18} strokeWidth={1.8} />
      </button>
    </nav>
  );
}
