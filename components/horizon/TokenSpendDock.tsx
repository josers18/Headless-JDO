"use client";

import { TokenSpendPanel } from "./TokenSpendPanel";

/**
 * Fixed dock that renders the Token Spend panel consistently on every banker
 * surface (Today / Ask / Analyze). Bottom-left so it clears the centered Ask
 * Bar (fixed bottom-center) and the left nav rail (64px, lg+). Hidden until
 * there's spend to show — the panel itself returns null when empty.
 *
 * Width is capped so the expanded table never clips, and the whole dock sits
 * below the Ask Bar's z-index band.
 */
export function TokenSpendDock() {
  return (
    <div className="pointer-events-none fixed bottom-[max(1.5rem,env(safe-area-inset-bottom,0px))] left-[80px] z-30 hidden w-[290px] lg:block">
      <div className="pointer-events-auto">
        <TokenSpendPanel />
      </div>
    </div>
  );
}
