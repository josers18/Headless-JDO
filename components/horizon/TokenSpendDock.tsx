"use client";

import { usePathname } from "next/navigation";
import { TokenSpendPanel } from "./TokenSpendPanel";

/**
 * Renders the Token Spend panel on the rail-less surfaces — Ask My Data and
 * Analyze. Today (`/`) mounts the panel in-flow in its right `<aside>` (under
 * Agent Log), so the dock deliberately skips it to avoid a double mount.
 *
 * Anchored top-right of the content area and expands DOWNWARD (collapsed by
 * default, so it starts as a slim pill). Fixed so it stays put while the
 * conversation scrolls; sized to clear the centered Ask/Analyze bars.
 */
export function TokenSpendDock() {
  const pathname = usePathname();
  // Today renders the panel inline in its own right rail — don't double up.
  if (pathname === "/") return null;

  return (
    <div className="pointer-events-none fixed right-4 top-20 z-30 hidden w-[300px] lg:block">
      <div className="pointer-events-auto">
        <TokenSpendPanel />
      </div>
    </div>
  );
}
