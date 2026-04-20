"use client";

import { useCallback, useRef, useState } from "react";
import type { Step } from "@/components/horizon/ReasoningTrail";
import type { AskThreadMessage } from "@/types/ask-thread";

/**
 * Shared client hook for streaming `/api/ask`, `/api/brief`, and
 * `/api/priority`. Parses our SSE protocol (see lib/anthropic/stream.ts) and
 * surfaces what the UI cares about:
 *   - `narrative`: accumulating text deltas (raw model output)
 *   - `steps`: reasoning trail with live per-step status
 *   - `state`: 'idle' | 'streaming' | 'done' | 'error'
 *
 * start(url)                → GET  (used for /api/priority)
 * start(url, body)          → POST (used for /api/ask, /api/brief)
 * start(url, body, opts)    → optional `onThreadSnapshot` for /api/ask
 */
export interface AgentStreamState {
  narrative: string;
  steps: Step[];
  state: "idle" | "streaming" | "done" | "error";
  error: string | null;
  toolCount: number;
  start: (
    url: string,
    body?: unknown,
    opts?: {
      method?: "GET" | "POST";
      onThreadSnapshot?: (messages: AskThreadMessage[]) => void;
    }
  ) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

type IncomingEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; server: string; tool: string; input: unknown }
  | {
      type: "tool_result";
      server: string;
      tool: string;
      is_error?: boolean;
      preview: string;
    }
  | { type: "error"; message: string }
  | { type: "thread_snapshot"; messages: AskThreadMessage[] }
  | { type: "done" };

export function useAgentStream(): AgentStreamState {
  const [narrative, setNarrative] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [state, setState] = useState<AgentStreamState["state"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setNarrative("");
    setSteps([]);
    setError(null);
    setState("idle");
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState("idle");
  }, []);

  const start = useCallback(
    async (
      url: string,
      body?: unknown,
      opts?: {
        method?: "GET" | "POST";
        onThreadSnapshot?: (messages: AskThreadMessage[]) => void;
      }
    ) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setNarrative("");
      setSteps([]);
      setError(null);
      setState("streaming");

      const method = opts?.method ?? (body !== undefined ? "POST" : "GET");

      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers:
            method === "POST"
              ? { "Content-Type": "application/json" }
              : undefined,
          body:
            method === "POST" && body !== undefined
              ? JSON.stringify(body)
              : undefined,
          signal: ctrl.signal,
        });
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
        return;
      }

      if (!res.ok || !res.body) {
        setError(
          res.status === 401
            ? "Session expired. Visit /api/connect to reactivate."
            : `Request failed: ${res.status}`
        );
        setState("error");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      const applyEvent = (msg: IncomingEvent) => {
        if (msg.type === "text_delta") {
          setNarrative((prev) => prev + msg.text);
        } else if (msg.type === "tool_use") {
          setSteps((prev) => [
            ...prev,
            {
              server: msg.server,
              tool: msg.tool,
              input: msg.input,
              status: "running",
            },
          ]);
        } else if (msg.type === "tool_result") {
          setSteps((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
              const s = prev[i];
              if (
                s &&
                s.server === msg.server &&
                s.tool === msg.tool &&
                s.status === "running"
              ) {
                const next = [...prev];
                next[i] = {
                  ...s,
                  status: msg.is_error ? "error" : "ok",
                  preview: msg.preview,
                };
                return next;
              }
            }
            return [
              ...prev,
              {
                server: msg.server,
                tool: msg.tool,
                status: msg.is_error ? "error" : "ok",
                preview: msg.preview,
              },
            ];
          });
        } else if (msg.type === "error") {
          setError(msg.message);
          setState("error");
        } else if (msg.type === "thread_snapshot" && Array.isArray(msg.messages)) {
          opts?.onThreadSnapshot?.(msg.messages);
        }
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.trim();
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            let msg: IncomingEvent;
            try {
              msg = JSON.parse(payload) as IncomingEvent;
            } catch {
              continue;
            }
            applyEvent(msg);
          }
        }
        setState("done");
      } catch (e) {
        if (!ctrl.signal.aborted) {
          setError(e instanceof Error ? e.message : String(e));
          setState("error");
        }
      }
    },
    []
  );

  return {
    narrative,
    steps,
    state,
    error,
    toolCount: steps.length,
    start,
    cancel,
    reset,
  };
}
