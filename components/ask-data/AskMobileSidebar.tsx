"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { MobileDrawer } from "@/components/horizon/mobile/MobileDrawer";
import { ThreadList } from "./ThreadList";

/**
 * Mobile-only thread picker for /ask. Renders a "Threads" trigger button
 * and a left-anchored drawer hosting the same <ThreadList /> the desktop
 * <aside> uses. Hidden at lg+ — desktop already has the sidebar.
 */
export function AskMobileSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex min-h-[44px] items-center gap-2 rounded-lg border border-border-soft bg-surface px-4 py-2 text-[13px] font-medium text-text transition hover:border-accent/50"
      >
        <Menu size={15} strokeWidth={1.8} aria-hidden />
        Threads
      </button>
      <MobileDrawer
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Browse Ask My Data threads"
        title="Threads"
      >
        <ThreadList onSelect={() => setOpen(false)} />
      </MobileDrawer>
    </div>
  );
}
