"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny pub/sub to shuttle follow-up suggestions from Conversation (which
 * receives them from /api/ask-data's SSE) into ContextRail (right rail)
 * without a full Context provider. Both components live inside the
 * (banker)/ask tree and only one Conversation is mounted at a time, so
 * a module-scoped store is sufficient.
 */

type State = string[];

let current: State = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function useFollowUpsBus() {
  const set = useCallback((next: State) => {
    current = next;
    emit();
  }, []);
  const clear = useCallback(() => {
    current = [];
    emit();
  }, []);
  return { set, clear };
}

export function useFollowUps(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current
  );
}
