"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AnalyzeBar, type AnalyzeBarRef } from "./AnalyzeBar";
import { AnalyzeTable } from "./AnalyzeTable";
import { ChartRenderer } from "./ChartRenderer";
import { StarterQuestions } from "./StarterQuestions";
import { AskDataTrace } from "@/components/ask-data/AskDataTrace";
import {
  useAnalyzeStream,
  type AnalyzeTable as AnalyzeTableType,
  type AnalyzeTraceStep,
} from "@/lib/client/useAnalyzeStream";
import type { ChartSpec } from "@/lib/analyze/chartTypes";
import { isChartType } from "@/lib/analyze/chartTypes";

type PersistedBlock = {
  type: string;
  [key: string]: unknown;
};

export type AnalyzeLatest = {
  question: string;
  content: PersistedBlock[];
  updatedAt: string;
};

export type AnalyzeWorkbenchProps = {
  modelId: string;
  /** Stable apiName of the SDM — drives per-model starter questions. */
  modelApiName: string;
  /** Persisted last-analysis from the server — null for first-time visit. */
  latest: AnalyzeLatest | null;
};

/**
 * Workbench body: the Ask bar, the live streaming area, and the
 * persisted last-turn rendering when no live turn is running. This
 * component is client-only because the stream hook needs to mount on
 * arrival.
 */
export function AnalyzeWorkbench({
  modelId,
  modelApiName,
  latest,
}: AnalyzeWorkbenchProps) {
  const barRef = useRef<AnalyzeBarRef | null>(null);
  const stream = useAnalyzeStream();
  const scrollAnchor = useRef<HTMLDivElement>(null);
  const [activeQuestion, setActiveQuestion] = useState<string | null>(null);

  const isStreaming = stream.state === "streaming";

  /*
   * Rendering strategy: once the banker submits anything in this
   * session, the LIVE stream becomes the authoritative source of truth
   * and stays rendered until they navigate away. We never copy live
   * state into a separate "latest" bucket — that double-source caused
   * the reasoning trail to disappear a few seconds after streaming
   * completed (the useEffect fired, React re-rendered with derived
   * blocks, and per-frame boolean state made content flicker out).
   *
   * - Before any live turn (state === "idle" AND narrative empty):
   *     render the persisted `latest` from the server.
   * - Once a turn has begun (state transitions away from "idle"):
   *     render live stream state until unmount.
   */
  const hasLiveTurn =
    stream.state !== "idle" ||
    stream.narrative.length > 0 ||
    stream.trace.length > 0 ||
    stream.tables.length > 0 ||
    stream.charts.length > 0;

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [
    stream.narrative,
    stream.trace.length,
    stream.tables.length,
    stream.charts.length,
  ]);

  async function handleSubmit(question: string) {
    setActiveQuestion(question);
    await stream.submit(modelId, question);
  }

  function handleCancel() {
    stream.cancel();
  }

  // Starter questions are always visible so the banker has concrete
  // clickable entry points regardless of whether they've used this
  // model before. Placed directly above the Ask bar so [suggestions]
  // and [input] read as one composition element — the banker's eye
  // always finds them together near the bottom of the main column.
  // Disabled during an in-flight stream to prevent queued duplicate
  // submits.
  return (
    <>
      <section className="mt-10 flex flex-col gap-6">
        {hasLiveTurn ? (
          <LiveTurn stream={stream} question={activeQuestion} />
        ) : (
          latest && <PersistedAnalysis latest={latest} />
        )}

        <div ref={scrollAnchor} />
      </section>

      <StarterQuestions
        apiName={modelApiName}
        onPick={(q) => void handleSubmit(q)}
        disabled={isStreaming}
      />

      <section className="mt-6">
        <AnalyzeBar
          innerRef={barRef}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          disabled={isStreaming}
          streaming={isStreaming}
        />
      </section>
    </>
  );
}

/**
 * Single component that renders everything produced by the live
 * stream. Isolates the live-view render logic so it isn't entangled
 * with the persisted-view path.
 */
function LiveTurn({
  stream,
  question,
}: {
  stream: ReturnType<typeof useAnalyzeStream>;
  question: string | null;
}) {
  const isStreaming = stream.state === "streaming";
  const hasNarrative = stream.narrative.length > 0;
  const hasTrace = stream.trace.length > 0;
  const hasCharts = stream.charts.length > 0;
  const hasTables = stream.tables.length > 0;

  return (
    <>
      {question && <QuestionEcho question={question} />}

      {hasTrace && (
        <AskDataTrace
          steps={stream.trace as AnalyzeTraceStep[]}
          defaultOpen={false}
        />
      )}

      {isStreaming && !hasNarrative && !hasTrace && (
        <div className="text-[13px] text-text-muted">
          Analyzing through Concierge…
        </div>
      )}

      {hasNarrative && (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-text">
          {stream.narrative}
          {isStreaming && (
            <span
              className={cn(
                "ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] animate-pulse bg-accent"
              )}
            />
          )}
        </div>
      )}

      {/* Charts supersede tables when available. */}
      {hasCharts
        ? stream.charts.map((c, i) => <ChartRenderer key={i} spec={c} />)
        : hasTables &&
          stream.tables.map((t, i) => <AnalyzeTable key={i} table={t} />)}

      {stream.state === "error" && stream.error && (
        <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger/90">
          {stream.error}
        </div>
      )}
    </>
  );
}

function PersistedAnalysis({ latest }: { latest: AnalyzeLatest }) {
  const narrative = flattenText(latest.content);
  const trace = extractTrace(latest.content);
  const tables = extractTables(latest.content);
  const charts = extractCharts(latest.content);

  if (
    !narrative &&
    trace.length === 0 &&
    tables.length === 0 &&
    charts.length === 0
  )
    return null;

  return (
    <div className="flex max-w-full flex-col gap-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-text-muted">
        Last analysis
      </div>

      {latest.question && <QuestionEcho question={latest.question} />}

      {trace.length > 0 && (
        <AskDataTrace
          steps={trace as AnalyzeTraceStep[]}
          defaultOpen={false}
        />
      )}

      {narrative && (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-text">
          {narrative}
        </div>
      )}

      {charts.length > 0
        ? charts.map((c, i) => <ChartRenderer key={i} spec={c} />)
        : tables.map((t, i) => <AnalyzeTable key={i} table={t} />)}
    </div>
  );
}

/**
 * Echoes the banker's question above the response. Styled as a right-
 * aligned bubble so it reads as "what the banker said" — same pattern
 * Ask My Data uses for user messages.
 */
function QuestionEcho({ question }: { question: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-surface-raised px-4 py-2.5 text-[14px] text-text">
        {question}
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────────

function flattenText(blocks: PersistedBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b && b.type === "text" && typeof b.text === "string") {
      parts.push(b.text as string);
    }
  }
  return parts.join("\n").trim();
}

function extractTrace(blocks: PersistedBlock[]): AnalyzeTraceStep[] {
  const uses = new Map<string, PersistedBlock>();
  const results = new Map<string, PersistedBlock>();
  for (const b of blocks) {
    if (b.type === "tool_use" && typeof b.id === "string") uses.set(b.id, b);
    if (b.type === "tool_result" && typeof b.tool_use_id === "string")
      results.set(b.tool_use_id as string, b);
  }
  const out: AnalyzeTraceStep[] = [];
  for (const [id, use] of uses) {
    const result = results.get(id);
    const name = (use.name as string) ?? "unknown";
    const input = use.input ?? {};
    out.push({
      callId: id,
      name,
      input,
      status: result ? (result.is_error ? "error" : "done") : "done",
      preview:
        result && typeof result.content === "string"
          ? (result.content as string).slice(0, 200)
          : undefined,
    });
  }
  return out;
}

function extractTables(blocks: PersistedBlock[]): AnalyzeTableType[] {
  const out: AnalyzeTableType[] = [];
  for (const b of blocks) {
    if (b.type !== "table_fallback") continue;
    const columns = Array.isArray(b.columns)
      ? (b.columns as unknown[]).filter((c): c is string => typeof c === "string")
      : [];
    const rows = Array.isArray(b.rows)
      ? (b.rows as Array<Record<string, unknown>>)
      : [];
    if (columns.length === 0 || rows.length === 0) continue;
    out.push({
      columns,
      rows,
      caption: typeof b.caption === "string" ? b.caption : undefined,
    });
  }
  return out;
}

function extractCharts(blocks: PersistedBlock[]): ChartSpec[] {
  const out: ChartSpec[] = [];
  for (const b of blocks) {
    if (b.type !== "chart_spec") continue;
    const spec = b.spec as unknown;
    if (!spec || typeof spec !== "object") continue;
    const obj = spec as Record<string, unknown>;
    if (!isChartType(obj.type)) continue;
    const props = obj.props as Record<string, unknown> | undefined;
    if (!props || !Array.isArray(props.data)) continue;
    // Trust persisted specs — they've already passed validateChartSpec.
    out.push(spec as ChartSpec);
  }
  return out;
}

