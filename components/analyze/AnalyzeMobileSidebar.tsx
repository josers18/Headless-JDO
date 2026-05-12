"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { MobileDrawer } from "@/components/horizon/mobile/MobileDrawer";
import { ModelList } from "./ModelList";

/**
 * Mobile-only model picker for /analyze. Renders a "Browse models" trigger
 * button and a left-anchored drawer hosting the same <ModelList /> the
 * desktop <aside> uses. Hidden at lg+ — desktop already has the sidebar.
 */
export function AnalyzeMobileSidebar() {
  const [open, setOpen] = useState(false);
  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex min-h-[44px] items-center gap-2 rounded-lg border border-border-soft bg-surface px-4 py-2 text-[13px] font-medium text-text transition hover:border-accent/50"
      >
        <Menu size={15} strokeWidth={1.8} aria-hidden />
        Browse models
      </button>
      <MobileDrawer
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Browse semantic models"
        title="Models"
      >
        <ModelList onSelect={() => setOpen(false)} />
      </MobileDrawer>
    </div>
  );
}
