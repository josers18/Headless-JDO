"use client";

import { useCallback, useRef, useState } from "react";
import type { AskDataSseEvent } from "@/lib/sse/askData";
import type { IterationUsage } from "@/components/horizon/ReasoningTrail";

export type AskDataState = "idle" | "streaming" | "done" | "error";

export type AskDataTraceStep = {
  callId: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  preview?: string;
  /** 1-based iteration this call belonged to (for grouping). */
  iteration?: number;
  /** Approx token size of this result the model ingested (estimate). */
  resultTokens?: number;
};

export interface AskDataStream {
  state: AskDataState;
  error: string | null;
  narrative: string;
  trace: AskDataTraceStep[];
  iterationUsage: IterationUsage[];
  threadTitle: string | null;
  followUps: string[];
  userMessageId: string | null;
  assistantMessageId: string | null;
  submit: (threadId: string, question: string) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

/**
 * Ask My Data's SSE client hook. Narrower vocabulary than Today's
 * useAgentStream — we want this path to stay decoupled.
 */
export function useAskDataStream(): AskDataStream {
  const [state, setState] = useState<AskDataState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState("");
  const [trace, setTrace] = useState<AskDataTraceStep[]>([]);
  const [iterationUsage, setIterationUsage] = useState<IterationUsage[]>([]);
  const currentIterationRef = useRef(0);
  const [threadTitle, setThreadTitle] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [userMessageId, setUserMessageId] = useState<string | null>(null);
  const [assistantMessageId, setAssistantMessageId] = useState<string | null>(
    null
  );
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setNarrative("");
    setTrace([]);
    setIterationUsage([]);
    currentIterationRef.current = 0;
    setThreadTitle(null);
    setFollowUps([]);
    setUserMessageId(null);
    setAssistantMessageId(null);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const submit = useCallback(
    async (threadId: string, question: string) => {
      reset();
      setState("streaming");

      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch("/api/ask-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, question }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setError(`Ask My Data request failed (${res.status}) ${text.slice(0, 200)}`);
          setState("error");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are "data: {json}\n\n" — split and parse each.
          while (true) {
            const sep = buffer.indexOf("\n\n");
            if (sep === -1) break;
            const frame = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!frame.startsWith("data:")) continue;
            const payload = frame.replace(/^data:\s*/, "");
            try {
              const ev = JSON.parse(payload) as AskDataSseEvent;
              applyEvent(ev);
            } catch {
              /* ignore keepalives / malformed frames */
            }
          }
        }
        if (state !== "error") setState("done");
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          setState("idle");
          return;
        }
        setError(e instanceof Error ? e.message : "stream failed");
        setState("error");
      }

      function applyEvent(ev: AskDataSseEvent) {
        switch (ev.type) {
          case "token":
            setNarrative((n) => n + ev.text);
            break;
          case "iteration_usage":
            currentIterationRef.current = ev.iteration;
            setIterationUsage((prev) => {
              const next = prev.filter((u) => u.iteration !== ev.iteration);
              next.push({
                iteration: ev.iteration,
                inputTokens: ev.inputTokens,
                outputTokens: ev.outputTokens,
                exact: ev.exact,
              });
              next.sort((a, b) => a.iteration - b.iteration);
              return next;
            });
            break;
          case "tool_call":
            setTrace((t) => [
              ...t,
              {
                callId: ev.callId,
                name: ev.name,
                input: ev.input,
                status: "running",
                iteration: currentIterationRef.current || undefined,
              },
            ]);
            break;
          case "tool_result":
            setTrace((t) =>
              t.map((s) =>
                s.callId === ev.callId
                  ? {
                      ...s,
                      status: ev.isError ? "error" : "done",
                      preview: ev.preview,
                      resultTokens: ev.resultTokens,
                    }
                  : s
              )
            );
            break;
          case "user_persisted":
            setUserMessageId(ev.messageId);
            break;
          case "assistant_persisted":
            setAssistantMessageId(ev.messageId);
            break;
          case "thread_title":
            setThreadTitle(ev.title);
            break;
          case "follow_ups":
            setFollowUps(ev.suggestions);
            break;
          case "error":
            setError(ev.message);
            setState("error");
            break;
          case "done":
            // `done` is a terminal frame from makeAskDataStream; let the
            // reader exit drive the state transition instead so errors
            // that arrived in the same stream take precedence.
            break;
        }
      }
    },
    [reset, state]
  );

  return {
    state,
    error,
    narrative,
    trace,
    iterationUsage,
    threadTitle,
    followUps,
    userMessageId,
    assistantMessageId,
    submit,
    reset,
    cancel,
  };
}
