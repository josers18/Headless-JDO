"use client";

import type { ReactNode } from "react";
import { DraftsProvider } from "./DraftsContext";
import { PullToRefresh } from "./PullToRefresh";

// MobileNav is mounted globally in app/(banker)/layout.tsx so it appears
// on /ask and /analyze too, not just /. Don't re-mount it here.
export function HorizonSignedIn({ children }: { children: ReactNode }) {
  return (
    <DraftsProvider>
      <PullToRefresh>{children}</PullToRefresh>
    </DraftsProvider>
  );
}
