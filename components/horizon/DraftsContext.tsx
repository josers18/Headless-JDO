"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAgentStream } from "@/lib/client/useAgentStream";
import { tryParseJson } from "@/lib/client/jsonStream";
import { HORIZON_REFRESH_DRAFTS } from "@/lib/client/horizonEvents";
import { AGENT_STAGGER_MS } from "@/lib/client/agentStartStagger";
import {
  extractRecordIdFromActionResult,
  type DraftCardStatus,
  type StreamedDraft,
} from "@/components/horizon/DraftActionCard";
import type { Step } from "@/components/horizon/ReasoningTrail";

type DraftsContextValue = {
  drafts: StreamedDraft[];
  /** Drafts whose `target_id` is not in the current priority queue client ids. */
  orphanDrafts: StreamedDraft[];
  steps: Step[];
  state: "idle" | "streaming" | "done" | "error";
  error: string | null;
  /** True until the staggered first `/api/drafts` fetch begins. */
  draftsKickoffPending: boolean;
  statuses: Record<string, DraftCardStatus>;
  setPriorityClientIds: (ids: string[]) => void;
  approve: (d: StreamedDraft) => Promise<void>;
  dismiss: (d: StreamedDraft) => void;
};

const DraftsContext = createContext<DraftsContextValue | null>(null);

export function DraftsProvider({ children }: { children: ReactNode }) {
  const { narrative, steps, state, error, start, reset } = useAgentStream();
  const [draftsKickoffPending, setDraftsKickoffPending] = useState(true);
  const [priorityIds, setPriorityIds] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Record<string, DraftCardStatus>>({});

  const setPriorityClientIds = useCallback((ids: string[]) => {
    setPriorityIds(new Set(ids));
  }, []);

  const runFetch = useCallback(() => {
    void start("/api/drafts", undefined, { method: "GET" }).catch(() => {});
  }, [start]);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      if (cancelled) return;
      setDraftsKickoffPending(false);
      runFetch();
    }, AGENT_STAGGER_MS.drafts);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [runFetch]);

  useEffect(() => {
    const onRefresh = () => {
      reset();
      runFetch();
    };
    window.addEventListener(HORIZON_REFRESH_DRAFTS, onRefresh);
    return () => window.removeEventListener(HORIZON_REFRESH_DRAFTS, onRefresh);
  }, [reset, runFetch]);

  const drafts = useMemo(() => {
    const parsed = tryParseJson<{ drafts?: StreamedDraft[] }>(narrative);
    return Array.isArray(parsed?.drafts) ? parsed?.drafts ?? [] : [];
  }, [narrative]);

  const orphanDrafts = useMemo(() => {
    if (priorityIds.size === 0) return drafts;
    return drafts.filter((d) => !priorityIds.has(d.target_id));
  }, [drafts, priorityIds]);

  const approve = useCallback(async (d: StreamedDraft) => {
    setStatuses((s) => ({ ...s, [d.id]: { kind: "executing" } }));
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: d }),
      });
      const json = (await res.json().catch(() => null)) as {
        result?: string;
        error?: string;
      } | null;
      if (!res.ok) {
        setStatuses((s) => ({
          ...s,
          [d.id]: {
            kind: "error",
            message: json?.error ?? `Execute failed (${res.status})`,
          },
        }));
        return;
      }
      const id = extractRecordIdFromActionResult(json?.result ?? "");
      setStatuses((s) => ({
        ...s,
        [d.id]: { kind: "done", recordId: id, message: json?.result ?? "" },
      }));
    } catch (e) {
      setStatuses((s) => ({
        ...s,
        [d.id]: {
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        },
      }));
    }
  }, []);

  const dismiss = useCallback((d: StreamedDraft) => {
    setStatuses((s) => ({ ...s, [d.id]: { kind: "dismissed" } }));
  }, []);

  const value = useMemo(
    (): DraftsContextValue => ({
      drafts,
      orphanDrafts,
      steps,
      state,
      error,
      draftsKickoffPending,
      statuses,
      setPriorityClientIds,
      approve,
      dismiss,
    }),
    [
      approve,
      dismiss,
      drafts,
      draftsKickoffPending,
      orphanDrafts,
      error,
      setPriorityClientIds,
      state,
      statuses,
      steps,
    ]
  );

  return (
    <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
  );
}

export function useDrafts(): DraftsContextValue {
  const v = useContext(DraftsContext);
  if (!v) {
    throw new Error("useDrafts must be used within DraftsProvider");
  }
  return v;
}

export function useOptionalDrafts(): DraftsContextValue | null {
  return useContext(DraftsContext);
}
