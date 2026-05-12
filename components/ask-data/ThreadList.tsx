"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  groupThreadsByRecency,
  type ThreadLike,
} from "@/lib/ask/threadGroups";
import { cn } from "@/lib/utils";

type FetchState =
  | { kind: "loading" }
  | { kind: "ready"; threads: ThreadLike[] }
  | { kind: "error"; message: string }
  | { kind: "unauth" }
  | { kind: "unconfigured" };

export function ThreadList({ onSelect }: { onSelect?: () => void } = {}) {
  const router = useRouter();
  const params = useParams();
  const activeThreadId =
    typeof params?.threadId === "string" ? params.threadId : null;

  const [state, setState] = useState<FetchState>({ kind: "loading" });
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/ask-threads", { cache: "no-store" });
      if (res.status === 401) {
        setState({ kind: "unauth" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: `Conversations unavailable (${res.status})` });
        return;
      }
      const data = (await res.json()) as {
        threads: ThreadLike[];
        db?: string;
      };
      // The API returns 200 with db:"unconfigured" when DATABASE_URL is
      // missing. We split that out from the normal "ready" state so the
      // UI can tell the user why their threads aren't there.
      if (data.db === "unconfigured") {
        setState({ kind: "unconfigured" });
        return;
      }
      setState({ kind: "ready", threads: data.threads ?? [] });
    } catch (e) {
      setState({
        kind: "error",
        message: e instanceof Error ? e.message : "Load failed",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(
    () => (state.kind === "ready" ? groupThreadsByRecency(state.threads) : []),
    [state]
  );

  async function createThread() {
    try {
      const res = await fetch("/api/ask-threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New conversation" }),
      });
      if (res.status === 503) {
        // Graceful: sidebar already communicates the "unconfigured"
        // state; reloading ensures it shows.
        await load();
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { thread: ThreadLike };
      router.push(`/ask/${data.thread.id}`);
      onSelect?.();
      await load();
    } catch {
      /* surfaced via sidebar refresh */
    }
  }

  async function removeThread(id: string) {
    if (busyId) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/ask-threads/${id}`, { method: "DELETE" });
      if (res.ok) {
        // If deleting the active thread, bounce back to /ask entry state.
        if (id === activeThreadId) router.push("/ask");
        await load();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto pb-8">
      <button
        type="button"
        onClick={createThread}
        className="mx-2 mt-1 flex items-center justify-between gap-2 rounded-lg border border-border-soft bg-surface/60 px-3 py-2.5 text-[13px] text-text-muted transition hover:border-accent/50 hover:text-text"
      >
        <span className="flex items-center gap-2">
          <Plus size={14} />
          New thread
        </span>
      </button>

      {state.kind === "loading" && (
        <div className="px-4 text-[12px] text-text-muted">Loading…</div>
      )}
      {state.kind === "error" && (
        <div className="flex flex-col items-start gap-2 px-4">
          <p className="text-[12px] text-danger/90">{state.message}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-md border border-border-soft px-2 py-1 text-[11px] text-text-muted transition hover:border-accent/50 hover:text-text"
          >
            <RefreshCw size={11} />
            Retry
          </button>
        </div>
      )}
      {state.kind === "unconfigured" && (
        <div className="px-4 text-[12px] text-text-muted">
          Conversation history disabled — DATABASE_URL is not configured
          in this environment.
        </div>
      )}
      {state.kind === "unauth" && (
        <div className="px-4 text-[12px] text-text-muted">
          Sign in to see your conversations.
        </div>
      )}
      {state.kind === "ready" && groups.length === 0 && (
        <div className="px-4 text-[12px] text-text-muted">
          No past conversations yet.
        </div>
      )}

      {state.kind === "ready" &&
        groups.map((group) => (
          <section key={group.label}>
            <div className="px-4 pb-1 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
              {group.label}
            </div>
            <ul>
              {group.threads.map((t) => {
                const active = t.id === activeThreadId;
                return (
                  <li
                    key={t.id}
                    className={cn(
                      "group/tl relative flex items-center gap-1 px-2",
                      active && "bg-surface-raised"
                    )}
                  >
                    <Link
                      href={`/ask/${t.id}`}
                      onClick={() => onSelect?.()}
                      className={cn(
                        "min-w-0 flex-1 truncate rounded-md px-2 py-2 text-[13px] transition",
                        active
                          ? "text-text"
                          : "text-text-muted hover:text-text"
                      )}
                      title={t.title}
                    >
                      {t.title}
                    </Link>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        void removeThread(t.id);
                      }}
                      disabled={busyId === t.id}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-text-muted opacity-0 transition hover:bg-surface2 hover:text-danger group-hover/tl:opacity-100 focus:opacity-100 disabled:opacity-50"
                      aria-label={`Delete ${t.title}`}
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
    </div>
  );
}
