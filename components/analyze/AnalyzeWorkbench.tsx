"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { AnalyzeBar, type AnalyzeBarRef } from "./AnalyzeBar";
import { AnalyzeTable } from "./AnalyzeTable";
import { AskDataTrace } from "@/components/ask-data/AskDataTrace";
import {
  useAnalyzeStream,
  type AnalyzeTable as AnalyzeTableType,
  type AnalyzeTraceStep,
} from "@/lib/client/useAnalyzeStream";

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
  /** Persisted last-analysis from the server — null for first-time visit. */
  latest: AnalyzeLatest | null;
};

/**
 * Workbench body: the Ask bar, the live streaming area, and the
 * persisted last-turn rendering when no live turn is running. This
 * component is client-only because the stream hook needs to mount on
 * arrival.
 */
export function AnalyzeWorkbench({ modelId, latest }: AnalyzeWorkbenchProps) {
  const barRef = useRef<AnalyzeBarRef | null>(null);
  const stream = useAnalyzeStream();
  const [activeLatest, setActiveLatest] = useState(latest);
  const scrollAnchor = useRef<HTMLDivElement>(null);

  const isStreaming = stream.state === "streaming";
  const hasLiveContent =
    stream.state !== "idle" ||
    stream.narrative.length > 0 ||
    stream.trace.length > 0 ||
    stream.tables.length > 0;

  // After a completed turn, store its content locally so we don't wipe
  // the UI on stream close. Newer live turn wins over persisted.
  useEffect(() => {
    if (stream.state !== "done") return;
    const blocks = hydrateBlocksFromStream(
      stream.narrative,
      stream.trace,
      stream.tables
    );
    setActiveLatest({
      question: "", // persisted question comes from server on next reload
      content: blocks,
      updatedAt: new Date().toISOString(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.state]);

  useEffect(() => {
    scrollAnchor.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [stream.narrative, stream.trace.length, stream.tables.length]);

  async function handleSubmit(question: string) {
    await stream.submit(modelId, question);
  }

  function handleCancel() {
    stream.cancel();
  }

  const showPersisted = !hasLiveContent && activeLatest;

  return (
    <>
      <section className="mt-10 flex flex-col gap-6">
        {isStreaming && stream.trace.length > 0 && (
          <div>
            <AskDataTrace
              steps={stream.trace as AnalyzeTraceStep[]}
              defaultOpen={false}
            />
          </div>
        )}

        {isStreaming && stream.narrative.length === 0 && stream.trace.length === 0 && (
          <div className="text-[13px] text-text-muted">
            Analyzing through Concierge…
          </div>
        )}

        {(isStreaming || stream.state === "done" || stream.state === "error") &&
          stream.narrative && (
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

        {stream.tables.map((t, i) => (
          <AnalyzeTable key={i} table={t} />
        ))}

        {stream.state === "error" && stream.error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger/90">
            {stream.error}
          </div>
        )}

        {showPersisted && <PersistedAnalysis latest={activeLatest} />}

        <div ref={scrollAnchor} />
      </section>

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

function PersistedAnalysis({ latest }: { latest: AnalyzeLatest }) {
  const narrative = flattenText(latest.content);
  const trace = extractTrace(latest.content);
  const tables = extractTables(latest.content);

  if (!narrative && trace.length === 0 && tables.length === 0) return null;

  return (
    <div className="max-w-full">
      <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-text-muted">
        Last analysis{" "}
        {latest.question && (
          <span className="normal-case text-text-muted/80">
            · &ldquo;{latest.question}&rdquo;
          </span>
        )}
      </div>

      {trace.length > 0 && (
        <div className="mb-3">
          <AskDataTrace
            steps={trace as AnalyzeTraceStep[]}
            defaultOpen={false}
          />
        </div>
      )}

      {narrative && (
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-text">
          {narrative}
        </div>
      )}

      {tables.map((t, i) => (
        <AnalyzeTable key={i} table={t} />
      ))}
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

/**
 * Build a content-block array from live stream state. Called at the
 * end of a turn so the UI can keep rendering without re-fetching.
 */
function hydrateBlocksFromStream(
  narrative: string,
  trace: AnalyzeTraceStep[],
  tables: AnalyzeTableType[]
): PersistedBlock[] {
  const out: PersistedBlock[] = [];
  if (narrative) out.push({ type: "text", text: narrative });
  for (const s of trace) {
    out.push({
      type: "tool_use",
      id: s.callId,
      name: s.name,
      input: s.input,
    });
    out.push({
      type: "tool_result",
      tool_use_id: s.callId,
      is_error: s.status === "error",
      content: s.preview ?? "",
    });
  }
  for (const t of tables) {
    out.push({
      type: "table_fallback",
      columns: t.columns,
      rows: t.rows,
      ...(t.caption ? { caption: t.caption } : {}),
    });
  }
  return out;
}
