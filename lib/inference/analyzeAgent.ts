/**
 * Analyze agent loop — orchestrates Kimi K2 Thinking against the
 * first-party Tableau Next MCP. Deliberately isolated from
 * lib/inference/askDataAgent.ts; shares the same normalized event
 * shape so UI primitives can be reused but the tool subset, prompt,
 * and error handling are Analyze-specific.
 *
 * Q-T2-arch-a = D: 9 curated tools (see CURATED_TOOLS below).
 * Q-T2-3-a = A: `list_semantic_models` is NOT exposed — the active
 *               SDM is injected into the system prompt instead.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { streamHeroku } from "@/lib/inference/heroku";
import type {
  TableauNextSession,
  TableauNextToolDef,
} from "@/lib/mcp/firstPartyTableauNext";
import { selectChartSpec } from "@/lib/analyze/chartSelector";
import type { ChartSpec } from "@/lib/analyze/chartTypes";
import { stripThinkTags } from "@/lib/analyze/sanitize";
import { extractStructuredFromProse } from "@/lib/analyze/proseToData";
import { sortRowsByDateLikeColumn } from "@/lib/analyze/sortByDate";
import { log } from "@/lib/log";

/**
 * Tools Kimi is allowed to see on the Analyze surface. Doc-grounded
 * curated set (see the Tableau Next docs reference + the "5 Critical /
 * High" tiers), minus `list_semantic_models` because the active SDM is
 * pre-selected via the URL.
 */
const CURATED_TOOLS = new Set([
  "analyze_data",
  "get_semantic_model",
  "list_semantic_model_metrics",
  "get_semantic_model_metric",
  "list_semantic_model_measures",
  "list_semantic_model_dimensions",
  "list_semantic_model_calculated_measures",
  "list_semantic_model_calculated_dimensions",
]);

const MAX_ITERATIONS = 5;
const ERROR_CIRCUIT_THRESHOLD = 3;

export type AnalyzeContentBlock = {
  type: string;
  [key: string]: unknown;
};

export type AnalyzeAgentEvent =
  | { type: "token"; text: string }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      callId: string;
      name: string;
      isError: boolean;
      preview: string;
    }
  | {
      type: "table_fallback";
      /** Parsed structured data we surfaced from an analyze_data response. */
      columns: string[];
      rows: Array<Record<string, unknown>>;
      caption?: string;
    }
  | {
      type: "chart_spec";
      spec: ChartSpec;
      wasFallback: boolean;
      fallbackReason?: string;
    }
  | {
      type: "turn_complete";
      text: string;
      /** Content blocks to persist as the stored analysis. */
      contentBlocks: AnalyzeContentBlock[];
    }
  | { type: "error"; message: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
      model: string;
    };

export interface AnalyzeAgentOptions {
  system: string;
  messages: ChatCompletionMessageParam[];
  mcp: TableauNextSession;
  signal?: AbortSignal;
  /**
   * The banker's question for this turn. Fed to the MiniMax chart
   * selector alongside table_fallback data so chart picks are
   * grounded in what the banker actually asked.
   */
  bankerQuestion: string;
  /**
   * When true, iteration 1 will force `tool_choice` to
   * `{type: "function", function: {name: "analyze_data"}}` instead of
   * "auto". Used by the route to correct Kimi's tendency to answer
   * visualization / drill-down follow-ups in prose instead of
   * calling the tool. Applies ONLY to iteration 1; after the tool
   * result comes back, subsequent iterations revert to "auto" so
   * the model can respond naturally.
   */
  forceAnalyzeDataFirstIteration?: boolean;
}

export async function* runAnalyzeAgent(
  options: AnalyzeAgentOptions
): AsyncGenerator<AnalyzeAgentEvent, void, unknown> {
  const {
    system,
    mcp,
    signal,
    bankerQuestion,
    forceAnalyzeDataFirstIteration,
  } = options;

  // Intersect the live tool list with our curated set — if Salesforce
  // removes or renames tools, we surface what's actually available.
  const allTools = await mcp.listTools();
  const visibleTools = allTools.filter((t) => CURATED_TOOLS.has(t.name));
  const toolDefs: ChatCompletionTool[] = visibleTools.map(toOpenAiTool);
  const visibleNames = new Set(visibleTools.map((t) => t.name));

  const messages: ChatCompletionMessageParam[] = [...options.messages];
  const contentBlocks: AnalyzeContentBlock[] = [];
  let accumulatedText = "";
  let consecutiveErrors = 0;
  let iteration = 0;

  /**
   * Turn-wide budget: names of tools that have already run
   * SUCCESSFULLY at least once in this turn. Once a tool appears
   * here, any later iteration that calls it again gets the
   * "duplicate suppressed" synthetic response.
   *
   * Rationale: Kimi otherwise "hedges" by calling analyze_data on
   * iteration 1, seeing the result, then calling it again with
   * rephrased args on iteration 2/3/4/5 — producing N charts for
   * one banker question. The per-iteration dedup below catches
   * parallel calls WITHIN one turn's streamHeroku response; this
   * set catches SEQUENTIAL calls across iterations.
   *
   * Scoped to idempotent-looking tools that produce charts
   * (analyze_data). Other tools (list_*, get_*) are allowed to
   * repeat — they're cheap metadata fetches.
   */
  const turnWideOnceTools: Set<string> = new Set(["analyze_data"]);
  const consumedTools = new Set<string>();

  // <think> stripper carries state across token chunks because tags can
  // span chunk boundaries. Returns the sanitized slice for this chunk.
  const thinkStripper = stripThinkTags();

  // Turn-wide (name, argsJson) dedup cache. Previously declared inside
  // the iteration loop, which meant it was cleared on every iteration
  // and Kimi could call e.g. `analyze_data({question: X})` on
  // iterations 1..5 and hit Tableau five times for identical args.
  // Lifting to turn scope means identical-args repeats are served
  // from memory.
  const toolResultCache = new Map<
    string,
    { modelText: string; isError: boolean }
  >();

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;
    if (signal?.aborted) {
      yield { type: "error", message: "Request cancelled." };
      return;
    }

    const inflightCalls = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >();
    let turnText = "";
    let stopReason: string | null = null;

    try {
      // Iteration 1 may FORCE analyze_data when the route detected a
      // visualization / drill-down follow-up. Kimi has been observed
      // to answer those in prose ("the data is already available...")
      // instead of re-calling the tool — which produces a narrative
      // with no chart. Forcing the tool call bypasses that failure
      // mode entirely on the one iteration where it matters; later
      // iterations revert to "auto" so the model can respond
      // naturally with ≤ 2 sentences of banker commentary after the
      // tool result lands.
      const shouldForce =
        iteration === 1 &&
        !!forceAnalyzeDataFirstIteration &&
        visibleNames.has("analyze_data");
      const toolChoice =
        toolDefs.length === 0
          ? undefined
          : shouldForce
          ? ({
              type: "function" as const,
              function: { name: "analyze_data" },
            } as const)
          : ("auto" as const);

      if (shouldForce) {
        log.info("analyze_agent.forcing_tool", {
          tool: "analyze_data",
          question: bankerQuestion.slice(0, 120),
        });
      }

      for await (const ev of streamHeroku({
        tier: "reasoning",
        system,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolChoice,
        maxTokens: 4000,
        signal,
      })) {
        if (ev.type === "token") {
          const sanitized = thinkStripper.push(ev.text);
          turnText += sanitized;
          accumulatedText += sanitized;
          if (sanitized) yield { type: "token", text: sanitized };
        } else if (ev.type === "tool_call") {
          const prev = inflightCalls.get(ev.index) ?? {
            id: "",
            name: "",
            argsJson: "",
          };
          if (ev.id) prev.id = ev.id;
          if (ev.name) prev.name = ev.name;
          if (ev.inputDelta) prev.argsJson += ev.inputDelta;
          inflightCalls.set(ev.index, prev);
        } else if (ev.type === "tool_call_complete") {
          inflightCalls.set(ev.index, {
            id: ev.id,
            name: ev.name,
            argsJson: JSON.stringify(ev.input ?? {}),
          });
        } else if (ev.type === "done") {
          stopReason = ev.stopReason;
        } else if (ev.type === "usage") {
          yield {
            type: "usage",
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            exact: ev.exact,
            model: ev.model,
          };
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "error", message };
      // If we haven't emitted any narrative yet, surface a banker-
      // facing fallback so the UI renders something + follow-ups can
      // still fire. Without this the banker sees a silent empty
      // response on Kimi upstream errors (timeout, 429, bad gateway).
      if (!accumulatedText.trim()) {
        const fallback =
          "The analytics engine had trouble with that question. Try rephrasing, narrowing the scope, or picking a different model.";
        accumulatedText = fallback;
        yield { type: "token", text: fallback };
        contentBlocks.push({ type: "text", text: fallback });
        yield {
          type: "turn_complete",
          text: fallback,
          contentBlocks,
        };
      }
      return;
    }

    const calls = [...inflightCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v)
      .filter((c) => c.name);

    if (turnText) {
      contentBlocks.push({ type: "text", text: turnText });
    }

    if (calls.length === 0) {
      let finalText = turnText.trim() || accumulatedText.trim();
      // Kimi emitted no tool calls AND no prose — the banker is left
      // staring at a blank response. Emit a helpful fallback as a
      // token so the UI renders something and follow-ups still fire
      // with non-empty context.
      if (!finalText) {
        finalText =
          "I couldn't answer that from this semantic model. The data or metric you asked about may not be available here — try rephrasing, or pick a different model from the sidebar.";
        accumulatedText = finalText;
        yield { type: "token", text: finalText };
        contentBlocks.push({ type: "text", text: finalText });
      }
      yield {
        type: "turn_complete",
        text: finalText,
        contentBlocks:
          contentBlocks.length > 0
            ? contentBlocks
            : [{ type: "text", text: finalText }],
      };
      return;
    }

    // Record the assistant turn with tool_calls before dispatching.
    messages.push({
      role: "assistant",
      content: turnText || " ",
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: {
          name: c.name,
          arguments: c.argsJson || "{}",
        },
      })),
    });

    // Two-layer duplicate guard:
    //
    //   (a) PER-ITERATION — if Kimi emits multiple calls to the same
    //       tool in one streamHeroku response, keep only the first.
    //       Catches parallel hedging: "call analyze_data 4 times with
    //       different phrasings at once".
    //
    //   (b) TURN-WIDE (turnWideOnceTools) — once a budget-limited
    //       tool has run successfully in ANY prior iteration of this
    //       turn, subsequent iterations can't call it again. Catches
    //       sequential hedging: "call analyze_data, see the result,
    //       call it again with a different phrasing next iteration".
    //
    // Both produce the same synthetic "duplicate suppressed" result
    // so Kimi learns to stop. Different-named tool calls (e.g.
    // get_semantic_model + analyze_data) are unaffected.
    const seenNames = new Set<string>();
    const duplicateCallIds = new Set<string>();
    for (const c of calls) {
      const alreadyThisIter = seenNames.has(c.name);
      const alreadyThisTurn =
        turnWideOnceTools.has(c.name) && consumedTools.has(c.name);
      if (alreadyThisIter || alreadyThisTurn) {
        duplicateCallIds.add(c.id);
      } else {
        seenNames.add(c.name);
      }
    }

    // Dispatch all tool calls in parallel.
    const dispatches = calls.map(async (c) => {
      if (duplicateCallIds.has(c.id)) {
        const body = {
          error: "duplicate suppressed",
          message:
            `You already issued a \`${c.name}\` call in this turn — ` +
            `only one is honored. Wait for that result, then respond ` +
            `with a ≤ 2-sentence banker insight. Do NOT call ${c.name} again this turn.`,
        };
        return {
          callId: c.id,
          name: c.name,
          isError: true,
          isSyntheticGuard: true,
          modelText: JSON.stringify(body),
          preview: `Duplicate ${c.name} suppressed.`,
          tableFallback: null as TableFallback | null,
          analyzeAnswer: null as string | null,
        };
      }
      if (!visibleNames.has(c.name)) {
        const body = {
          error: "unknown tool",
          message: `Tool "${c.name}" is not available. Use one of: ${[...visibleNames].join(", ")}.`,
        };
        return {
          callId: c.id,
          name: c.name,
          isError: true,
          isSyntheticGuard: true,
          modelText: JSON.stringify(body),
          preview: `Unknown tool: ${c.name}`,
          tableFallback: null as TableFallback | null,
        };
      }

      const cacheKey = `${c.name}|${c.argsJson}`;
      const cached = toolResultCache.get(cacheKey);
      if (cached) {
        return {
          callId: c.id,
          name: c.name,
          isError: cached.isError,
          modelText: cached.modelText,
          preview: cached.modelText.slice(0, 200),
          tableFallback: null as TableFallback | null,
        };
      }

      let args: Record<string, unknown> = {};
      try {
        args = c.argsJson
          ? (JSON.parse(c.argsJson) as Record<string, unknown>)
          : {};
      } catch {
        args = {};
      }
      const r = await mcp.callTool(c.name, args);
      toolResultCache.set(cacheKey, {
        modelText: r.modelText,
        isError: r.isError,
      });
      const tableFallback =
        c.name === "analyze_data" && !r.isError
          ? extractTableFallback(r.modelText)
          : null;
      const analyzeAnswer =
        c.name === "analyze_data" && !r.isError
          ? extractAnalyzeAnswer(r.modelText)
          : null;
      return {
        callId: c.id,
        name: c.name,
        isError: r.isError,
        modelText: r.modelText,
        preview: r.textPreview,
        tableFallback,
        analyzeAnswer,
      };
    });

    // Stream tool_call rows + build content blocks before awaiting.
    for (const c of calls) {
      let parsed: unknown = {};
      try {
        parsed = c.argsJson ? JSON.parse(c.argsJson) : {};
      } catch {
        parsed = { _raw: c.argsJson };
      }
      yield { type: "tool_call", callId: c.id, name: c.name, input: parsed };
      contentBlocks.push({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: parsed,
      });
    }
    const results = await Promise.all(dispatches);

    // Mark any successfully-executed budget-limited tool as consumed
    // for the remainder of this turn. Errors don't burn the budget —
    // Kimi should be allowed to retry a genuinely failed call on the
    // next iteration.
    for (const r of results) {
      if (!r.isError && turnWideOnceTools.has(r.name)) {
        consumedTools.add(r.name);
      }
    }

    // Emit tool_call result events + push raw blocks + feed the model
    // message. Answer emission + chart extraction are deferred so we
    // can dedupe across multiple analyze_data calls in the same turn.
    for (const r of results) {
      yield {
        type: "tool_result",
        callId: r.callId,
        name: r.name,
        isError: r.isError,
        preview: cleanPreview(r.name, r.preview, r.analyzeAnswer),
      };
      contentBlocks.push({
        type: "tool_result",
        tool_use_id: r.callId,
        is_error: r.isError,
        content: r.modelText,
      });
      messages.push({
        role: "tool" as const,
        tool_call_id: r.callId,
        content: r.modelText,
      });

      // Only real MCP failures feed the circuit breaker. Synthetic
      // guard rejections (duplicate suppressed, unknown tool name)
      // are model-behavior corrections, not infrastructure failures —
      // counting them would trip the breaker against a threat we
      // invented, killing the turn with no banker-visible answer.
      const isSynthetic = (r as { isSyntheticGuard?: boolean }).isSyntheticGuard === true;
      if (r.isError && !isSynthetic) consecutiveErrors += 1;
      else if (!r.isError) consecutiveErrors = 0;
      // Synthetic errors leave the counter unchanged.
    }

    // Dedupe narrative emission across multiple analyze_data calls
    // (Kimi sometimes decomposes "show X by month" into an aggregate
    // call + a monthly breakdown call, resulting in two answers that
    // used to get emitted back-to-back as doubled prose).
    //
    // Strategy: pick the single most-useful answer — the longest one
    // that's plausibly a real breakdown (the "overall average is 70.15"
    // answer is short; the month-by-month answer is long). Emit that
    // and feed it to prose extraction; discard the others.
    const successfulAnalyze = results.filter(
      (r) =>
        r.name === "analyze_data" &&
        !r.isError &&
        r.analyzeAnswer &&
        r.analyzeAnswer.length > 0
    );
    const dominant = pickDominantAnswer(successfulAnalyze);

    if (dominant && dominant.analyzeAnswer) {
      const text = dominant.analyzeAnswer;
      turnText += text;
      accumulatedText += text;
      yield { type: "token", text };
      contentBlocks.push({ type: "text", text });

      // Prose → structured data extraction. Runs only on the dominant
      // (longest) answer since it's most likely to contain tabular
      // breakdowns.
      if (!dominant.tableFallback && text.length >= 30) {
        try {
          const extracted = await extractStructuredFromProse({
            question: bankerQuestion,
            prose: text,
          });
          if (extracted && extracted.rows.length > 0) {
            // MiniMax preserves narrative order (typically
            // "highlights first"), which plots out of sequence when
            // the x-axis is a date. Sort chronologically when a date-
            // like column exists; pass through unchanged otherwise.
            const { sorted } = sortRowsByDateLikeColumn(
              extracted.columns,
              extracted.rows
            );
            dominant.tableFallback = {
              columns: extracted.columns,
              rows: sorted,
            };
          }
        } catch {
          /* prose extraction is best-effort */
        }
      }
    }

    // Emit table fallbacks + chart specs. We prefer the dominant
    // analyze_data's fallback; other calls with their own structured
    // data still get their tables rendered for completeness.
    const fallbackEmitters = dominant
      ? [dominant, ...results.filter((r) => r !== dominant && r.tableFallback)]
      : results.filter((r) => r.tableFallback);

    for (const r of fallbackEmitters) {
      if (!r.tableFallback) continue;
      yield {
        type: "table_fallback",
        columns: r.tableFallback.columns,
        rows: r.tableFallback.rows,
        caption: r.tableFallback.caption,
      };
      contentBlocks.push({
        type: "table_fallback",
        columns: r.tableFallback.columns,
        rows: r.tableFallback.rows,
        ...(r.tableFallback.caption ? { caption: r.tableFallback.caption } : {}),
      });

      // Chart selection per fallback.
      try {
        const picked = await selectChartSpec({
          bankerQuestion,
          data: r.tableFallback.rows,
          caption: r.tableFallback.caption,
        });
        yield {
          type: "chart_spec",
          spec: picked.spec,
          wasFallback: picked.wasFallback,
          ...(picked.fallbackReason
            ? { fallbackReason: picked.fallbackReason }
            : {}),
        };
        contentBlocks.push({
          type: "chart_spec",
          spec: picked.spec as unknown as Record<string, unknown>,
          wasFallback: picked.wasFallback,
          ...(picked.fallbackReason
            ? { fallbackReason: picked.fallbackReason }
            : {}),
        });
      } catch {
        /* non-fatal — the table_fallback already rendered */
      }
    }

    if (consecutiveErrors >= ERROR_CIRCUIT_THRESHOLD) {
      const msg = `Tableau Next dispatch failed ${consecutiveErrors} times in a row. Stopping to avoid a runaway loop.`;
      yield { type: "error", message: msg };
      const finalText =
        accumulatedText.trim() ||
        "I hit repeated errors trying to reach Tableau Next and couldn't complete this question.";
      yield {
        type: "turn_complete",
        text: finalText,
        contentBlocks:
          contentBlocks.length > 0
            ? contentBlocks
            : [{ type: "text", text: finalText }],
      };
      return;
    }

    if (stopReason && stopReason !== "tool_calls") {
      // Defensive — if the model reports a non-tool stop but we still
      // dispatched, the next iteration runs anyway.
    }
  }

  const finalText =
    accumulatedText.trim() ||
    "I ran out of steps before finishing this question — try a narrower ask.";
  yield {
    type: "turn_complete",
    text: finalText,
    contentBlocks:
      contentBlocks.length > 0
        ? contentBlocks
        : [{ type: "text", text: finalText }],
  };
}

function toOpenAiTool(t: TableauNextToolDef): ChatCompletionTool {
  const schema: Record<string, unknown> = { ...t.inputSchema };
  if (!("type" in schema)) schema.type = "object";
  if (!("properties" in schema) || !schema.properties) schema.properties = {};
  return {
    type: "function",
    function: {
      name: t.name,
      description: (t.description ?? "").slice(0, 1024) || undefined,
      parameters: schema,
    },
  };
}

// ─── analyze_data answer extraction ────────────────────────────────────

/**
 * Pull the natural-language answer out of an analyze_data response.
 * Tableau wraps the real answer in a few possible shapes:
 *
 *   { answer: "..." }                            — simple shape
 *   { defaultExc: "{\"answer\":\"...\"}" }        — observed live: JSON
 *                                                  string inside defaultExc,
 *                                                  HTML-encoded (&#39; etc.)
 *
 * Returns null if no answer string is found, trimmed of HTML entities
 * and length-capped to 4KB (typical answer is 300-2000 chars).
 */
function extractAnalyzeAnswer(text: string): string | null {
  if (!text || text.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const directAnswer = typeof obj.answer === "string" ? obj.answer : null;
  if (directAnswer) return cleanAnswer(directAnswer);

  // Nested defaultExc (observed on this org's Analytics Agent responses).
  const defaultExc = obj.defaultExc;
  if (typeof defaultExc === "string") {
    try {
      const inner = JSON.parse(defaultExc) as Record<string, unknown>;
      if (typeof inner.answer === "string") return cleanAnswer(inner.answer);
    } catch {
      // Sometimes defaultExc itself is a plain sentence. Use it as-is.
      return cleanAnswer(defaultExc);
    }
  }

  // Some Analytics Agent responses put the narrative under "message".
  if (typeof obj.message === "string") return cleanAnswer(obj.message);

  return null;
}

/**
 * Banker-friendly preview for the reasoning trail. For analyze_data
 * results, show the extracted answer (not the raw nested JSON that the
 * MCP returns). For other tools (metadata listings, etc.), the raw
 * preview is fine since it's short JSON the agent only sees internally.
 */
function cleanPreview(
  toolName: string,
  rawPreview: string,
  analyzeAnswer: string | null | undefined
): string {
  if (toolName === "analyze_data" && analyzeAnswer) {
    // Strip markdown emphasis so the single-line preview reads as prose.
    const oneLine = analyzeAnswer
      .replace(/\s*\n+\s*/g, " ")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .trim();
    return oneLine.slice(0, 200);
  }
  return rawPreview;
}

type AnalyzeResult = {
  callId: string;
  name: string;
  isError: boolean;
  modelText: string;
  preview: string;
  tableFallback: TableFallback | null;
  analyzeAnswer?: string | null;
};

/**
 * When Kimi makes multiple analyze_data calls in one turn, pick the
 * single most useful answer to surface as narrative. Heuristic: the
 * longest answer — brief aggregates ("the average is 70.15") rarely
 * contain tabular breakdowns; longer answers almost always do.
 */
function pickDominantAnswer(
  candidates: AnalyzeResult[]
): AnalyzeResult | null {
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  for (const c of candidates) {
    if ((c.analyzeAnswer?.length ?? 0) > (best.analyzeAnswer?.length ?? 0)) {
      best = c;
    }
  }
  return best;
}

function cleanAnswer(s: string): string {
  const decoded = s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
  return decoded.slice(0, 4_000);
}

// ─── Table fallback extraction ─────────────────────────────────────────

type TableFallback = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  caption?: string;
};

/**
 * Pull a structured data set out of an `analyze_data` response so the
 * UI can render a markdown table below the narrative (Q-T2-3-c = B).
 * Tableau's answer payload varies — we probe a few common shapes and
 * return null when none match, which is fine (the UI just skips it).
 */
function extractTableFallback(text: string): TableFallback | null {
  if (!text || text.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  // Shape 1: { data: { columns: [...], rows: [...] } }
  const data = obj.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.columns) && Array.isArray(d.rows)) {
      return normalize(d.columns, d.rows, asString(obj.answer));
    }
  }

  // Shape 2: { result: [...] } where result is an array of row objects
  if (Array.isArray(obj.result) && obj.result.length > 0) {
    const first = obj.result[0];
    if (first && typeof first === "object") {
      const columns = Object.keys(first as Record<string, unknown>);
      return normalize(columns, obj.result, asString(obj.answer));
    }
  }

  // Shape 3: bare { columns: [...], rows: [...] }
  if (Array.isArray(obj.columns) && Array.isArray(obj.rows)) {
    return normalize(obj.columns, obj.rows, asString(obj.answer));
  }

  return null;
}

function normalize(
  columnsRaw: unknown[],
  rowsRaw: unknown[],
  caption: string | undefined
): TableFallback | null {
  const columns: string[] = [];
  for (const c of columnsRaw) {
    if (typeof c === "string") columns.push(c);
    else if (c && typeof c === "object") {
      const name = (c as Record<string, unknown>).name;
      if (typeof name === "string") columns.push(name);
    }
  }
  if (columns.length === 0) return null;

  const rows: Array<Record<string, unknown>> = [];
  for (const r of rowsRaw.slice(0, 50)) {
    if (Array.isArray(r)) {
      const row: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        row[col] = r[i];
      });
      rows.push(row);
    } else if (r && typeof r === "object") {
      rows.push(r as Record<string, unknown>);
    }
  }
  if (rows.length === 0) return null;

  return {
    columns,
    rows,
    ...(caption && caption.length <= 500 ? { caption } : {}),
  };
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
