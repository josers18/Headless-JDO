"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

const SfInstanceContext = createContext<string | null>(null);

export function SfInstanceProvider({
  instanceUrl,
  children,
}: {
  instanceUrl: string | null;
  children: ReactNode;
}) {
  return (
    <SfInstanceContext.Provider value={instanceUrl}>
      {children}
    </SfInstanceContext.Provider>
  );
}

export function useSfInstanceUrl(): string | null {
  return useContext(SfInstanceContext);
}
