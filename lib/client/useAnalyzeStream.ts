"use client";

import { useCallback, useRef, useState } from "react";
import type { AnalyzeSseEvent } from "@/lib/sse/analyze";
import type { ChartSpec } from "@/lib/analyze/chartTypes";
import type { IterationUsage } from "@/components/horizon/ReasoningTrail";

export type AnalyzeState = "idle" | "streaming" | "done" | "error";

export type AnalyzeTraceStep = {
  callId: string;
  name: string;
  input: unknown;
  status: "running" | "done" | "error";
  preview?: string;
  iteration?: number;
  resultTokens?: number;
};

export type AnalyzeTable = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  caption?: string;
};

export type AnalyzePriorTurn = {
  userQuestion: string;
  assistantText: string;
};

export interface AnalyzeStream {
  state: AnalyzeState;
  error: string | null;
  narrative: string;
  trace: AnalyzeTraceStep[];
  iterationUsage: IterationUsage[];
  tables: AnalyzeTable[];
  charts: ChartSpec[];
  persisted: boolean;
  submit: (
    modelId: string,
    question: string,
    priorTurns?: AnalyzePriorTurn[]
  ) => Promise<void>;
  reset: () => void;
  cancel: () => void;
}

export function useAnalyzeStream(): AnalyzeStream {
  const [state, setState] = useState<AnalyzeState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [narrative, setNarrative] = useState("");
  const [trace, setTrace] = useState<AnalyzeTraceStep[]>([]);
  const [iterationUsage, setIterationUsage] = useState<IterationUsage[]>([]);
  const currentIterationRef = useRef(0);
  const [tables, setTables] = useState<AnalyzeTable[]>([]);
  const [charts, setCharts] = useState<ChartSpec[]>([]);
  const [persisted, setPersisted] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setNarrative("");
    setTrace([]);
    setIterationUsage([]);
    currentIterationRef.current = 0;
    setTables([]);
    setCharts([]);
    setPersisted(false);
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const submit = useCallback(
    async (
      modelId: string,
      question: string,
      priorTurns?: AnalyzePriorTurn[]
    ) => {
      reset();
      setState("streaming");

      const controller = new AbortController();
      abortRef.current = controller;
      let hadError = false;

      try {
        const res = await fetch("/api/analyze-ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            question,
            priorTurns: priorTurns ?? [],
          }),
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
            return false;
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
            return false;
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
          case "chart_spec":
            setCharts((c) => [...c, ev.spec]);
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
    iterationUsage,
    tables,
    charts,
    persisted,
    submit,
    reset,
    cancel,
  };
}
