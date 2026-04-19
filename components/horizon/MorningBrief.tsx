"use client";

import { useEffect } from "react";
import { ReasoningTrail } from "./ReasoningTrail";
import { useAgentStream } from "@/lib/client/useAgentStream";

export function MorningBrief() {
  const { narrative, steps, state, error, start } = useAgentStream();

  useEffect(() => {
    void start("/api/brief", {});
    // Intentionally not cancelling on unmount — keep the brief hydrated
    // across a quick re-mount during dev HMR.
  }, [start]);

  const isLoading = state === "streaming" && narrative.length === 0;

  return (
    <div>
      <div className="text-xs uppercase tracking-[0.18em] text-text-muted">
        Today
      </div>
      <div className="mt-4 font-display text-[34px] leading-[1.15] tracking-tight text-text text-balance md:text-[44px]">
        {narrative ? (
          <>
            {narrative}
            {state === "streaming" && (
              <span className="ml-1 inline-block h-[1em] w-[3px] translate-y-[4px] animate-pulse bg-accent" />
            )}
          </>
        ) : isLoading ? (
          <span className="inline-block h-[1em] w-[70%] max-w-[520px] rounded shimmer" />
        ) : error ? (
          <span className="text-text-muted">{error}</span>
        ) : (
          "Ready."
        )}
      </div>
      {steps.length > 0 && (
        <div className="mt-6">
          <ReasoningTrail steps={steps} />
        </div>
      )}
    </div>
  );
}
