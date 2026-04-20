"use client";

import type { ReactNode } from "react";
import { DraftsProvider } from "./DraftsContext";
import { PullToRefresh } from "./PullToRefresh";
import { MobileNav } from "./mobile/MobileNav";

export function HorizonSignedIn({ children }: { children: ReactNode }) {
  return (
    <DraftsProvider>
      <PullToRefresh>{children}</PullToRefresh>
      <MobileNav />
    </DraftsProvider>
  );
}
