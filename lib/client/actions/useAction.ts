"use client";

import { useCallback, useEffect, useState } from "react";
import {
  agentLog,
  dispatchAction,
  type AgentLogEntry,
  type DispatchOptions,
  type HorizonAction,
} from "./registry";

export function useAgentLog(): AgentLogEntry[] {
  const [entries, setEntries] = useState<AgentLogEntry[]>(() => agentLog.all());
  useEffect(() => agentLog.subscribe(setEntries), []);
  return entries;
}

/** Hook that returns a stable dispatcher for a given focus context. */
export function useActionDispatcher(opts: DispatchOptions = {}) {
  return useCallback(
    (action: HorizonAction) => dispatchAction(action, opts),
    // opts is captured by reference; callers should memoize it themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.focus?.clientId, opts.focus?.clientName]
  );
}
