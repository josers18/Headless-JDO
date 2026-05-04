"use client";

import { useCallback, useRef, useState } from "react";
import type { AnalyzeSseEvent } from "@/lib/sse/analyze";

export type AnalyzeState = "idle" | "streaming" | "done" | "error";

export type AnalyzeTraceStep = {
  callId: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  preview?: string;
};

export type AnalyzeTable = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  caption?: string;
};

export interface AnalyzeStream {
  state: AnalyzeState;
  error: string | null;
  narrative: string;
  trace: AnalyzeTraceStep[];
  tables: AnalyzeTable[];
  persisted: boolean;
  submit: (modelId: string, question: string) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useAnalyzeStream(): AnalyzeStream {
  const [state, setState] = useState<AnalyzeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState("");
  const [trace, setTrace] = useState<AnalyzeTraceStep[]>([]);
  const [tables, setTables] = useState<AnalyzeTable[]>([]);
  const [persisted, setPersisted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setNarrative("");
    setTrace([]);
    setTables([]);
    setPersisted(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const submit = useCallback(
    async (modelId: string, question: string) => {
      reset();
      setState("streaming");

      const controller = new AbortController();
      abortRef.current = controller;
      let hadError = false;

      try {
        const res = await fetch("/api/analyze-ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ modelId, question }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => "");
          setError(
            `Analyze request failed (${res.status}) ${text.slice(0, 200)}`
          );
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
          while (true) {
            const sep = buffer.indexOf("\n\n");
            if (sep === -1) break;
            const frame = buffer.slice(0, sep).trim();
            buffer = buffer.slice(sep + 2);
            if (!frame.startsWith("data:")) continue;
            const payload = frame.replace(/^data:\s*/, "");
            try {
              const ev = JSON.parse(payload) as AnalyzeSseEvent;
              if (applyEvent(ev)) hadError = true;
            } catch {
              /* ignore malformed frames */
            }
          }
        }
        if (!hadError) setState("done");
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") {
          setState("idle");
          return;
        }
        setError(e instanceof Error ? e.message : "stream failed");
        setState("error");
      }

      /**
       * Apply an SSE event to local state. Returns true if the event
       * was an error (caller uses that to skip the "done" transition).
       */
      function applyEvent(ev: AnalyzeSseEvent): boolean {
        switch (ev.type) {
          case "token":
            setNarrative((n) => n + ev.text);
            return false;
          case "tool_call":
            setTrace((t) => [
              ...t,
              {
                callId: ev.callId,
                name: ev.name,
                input: ev.input,
                status: "running",
              },
            ]);
            return false;
          case "tool_result":
            setTrace((t) =>
              t.map((s) =>
                s.callId === ev.callId
                  ? {
                      ...s,
                      status: ev.isError ? "error" : "done",
                      preview: ev.preview,
                    }
                  : s
              )
            );
            return false;
          case "table_fallback":
            setTables((tt) => [
              ...tt,
              {
                columns: ev.columns,
                rows: ev.rows,
                caption: ev.caption,
              },
            ]);
            return false;
          case "persisted":
            setPersisted(true);
            return false;
          case "error":
            setError(ev.message);
            setState("error");
            return true;
          case "done":
            return false;
        }
      }
    },
    [reset]
  );

  return {
    state,
    error,
    narrative,
    trace,
    tables,
    persisted,
    submit,
    reset,
    cancel,
  };
}
