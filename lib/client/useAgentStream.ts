"use client";

import { useCallback, useRef, useState } from "react";
import type { Step } from "@/components/horizon/ReasoningTrail";

/**
 * Shared client hook for streaming `/api/ask` and `/api/brief`. Parses our
 * SSE protocol and surfaces the three pieces the UI cares about:
 *   - `narrative`: accumulating text
 *   - `steps`: reasoning trail with live per-step status
 *   - `state`: 'idle' | 'streaming' | 'done' | 'error'
 *
 * The SSE event shapes are defined in `lib/anthropic/stream.ts`.
 */
export interface AgentStreamState {
  narrative: string;
  steps: Step[];
  state: "idle" | "streaming" | "done" | "error";
  error: string | null;
  toolCount: number;
  start: (url: string, body: unknown) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

type IncomingEvent =
  | { type: "text_delta"; text: string }
  | {
      type: "tool_use";
      server: string;
      tool: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      server: string;
      tool: string;
      is_error?: boolean;
      preview: string;
    }
  | { type: "error"; message: string }
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

  const start = useCallback(async (url: string, body: unknown) => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setNarrative("");
    setSteps([]);
    setError(null);
    setState("streaming");

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
          ? "Not signed in to Salesforce. Go to /api/auth/salesforce/login."
          : `Request failed: ${res.status}`
      );
      setState("error");
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

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

    function applyEvent(msg: IncomingEvent) {
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
          // Match to the most recent running step for the same server+tool.
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
          // Fallback: append as a standalone result row.
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
      }
      // 'done' is handled by the reader loop exit.
    }
  }, []);

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
