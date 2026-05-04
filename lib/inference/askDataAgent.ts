/**
 * Ask My Data agent loop — orchestrates Kimi K2 Thinking against the
 * self-hosted Data 360 MCP. Deliberately isolated from lib/llm/heroku.ts;
 * re-uses the same OpenAI-compatible tool-call semantics but owns its own
 * vocabulary, tool-filter policy, dedup cache, and error handling so
 * Today's loop can evolve without collateral damage here.
 *
 * Yields normalized events via an async generator:
 *   - tokens (assistant prose deltas)
 *   - tool_call (banker-visible reasoning trail row: the agent invoked X)
 *   - tool_result (trail row: response preview)
 *   - turn_complete (final assistant text + tool-use/tool-result blocks,
 *                    ready to persist as an assistant message)
 *
 * Per Q-T1-3-b = A we use a tight system prompt and do NOT preload a
 * metadata catalog. Kimi decides when to call `get_data_lake_objects` or
 * `describe_data_lake_object` itself.
 *
 * Per Q-T1-3-a = B we drop the two mutating tools (ingest_records,
 * publish_segment) from the tool list Kimi sees.
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { streamHeroku } from "@/lib/inference/heroku";
import type { SelfDcSession, SelfDcToolDef } from "@/lib/mcp/selfHostedDataCloud";

// Tools the model may NOT call in Ask My Data. Exploratory surface only;
// we never let the agent mutate on behalf of the banker.
const DROPPED_TOOLS = new Set(["ingest_records", "publish_segment"]);

// Soft budget: if the agent hasn't answered after N tool-call iterations
// we bail. Heroku router already stalls long requests — this keeps us well
// under that window.
const MAX_ITERATIONS = 6;

// If the same error surfaces this many times in a row we stop dispatching
// to prevent runaway loops against a broken MCP.
const ERROR_CIRCUIT_THRESHOLD = 3;

/**
 * Content block stored on ask_my_data_messages.content — always has a
 * `type` tag so downstream renderers can switch on it.
 */
export type AskDataContentBlock = {
  type: string;
  [key: string]: unknown;
};

export type AskDataAgentEvent =
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
      type: "turn_complete";
      text: string;
      /**
       * Serialized content blocks for the assistant message — text +
       * tool-use + tool-result blocks — so `appendMessage` can store the
       * full conversational record per the SETTLED DECISION.
       */
      contentBlocks: AskDataContentBlock[];
    }
  | { type: "error"; message: string };

export interface AskDataAgentOptions {
  /** System prompt. Kept tight (Q-T1-3-b = A). */
  system: string;
  /** Prior messages (user + assistant turns from DB), plus the new user turn. */
  messages: ChatCompletionMessageParam[];
  /** Open MCP session owned by the caller. */
  mcp: SelfDcSession;
  /** Abort when the client disconnects. */
  signal?: AbortSignal;
}

/**
 * Runs the tool-call loop. Yields events as they're produced; the caller
 * forwards them to the SSE stream and persists the final content blocks.
 */
export async function* runAskDataAgent(
  options: AskDataAgentOptions
): AsyncGenerator<AskDataAgentEvent, void, unknown> {
  const { system, mcp, signal } = options;

  // Build visible tool list once per session. MCP schemas come back as
  // JSON Schema; we wrap them in OpenAI's `function` tool envelope.
  const allTools = await mcp.listTools();
  const visibleTools = allTools.filter((t) => !DROPPED_TOOLS.has(t.name));
  const toolDefs: ChatCompletionTool[] = visibleTools.map((t) =>
    toOpenAiTool(t)
  );
  const visibleNames = new Set(visibleTools.map((t) => t.name));

  const messages: ChatCompletionMessageParam[] = [...options.messages];

  // Blocks we'll persist as the assistant message when the turn ends.
  const contentBlocks: AskDataContentBlock[] = [];
  let accumulatedText = "";
  let consecutiveErrors = 0;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration += 1;
    if (signal?.aborted) {
      yield { type: "error", message: "Request cancelled." };
      return;
    }

    // Dedup tool calls within this turn: if the model asks for the same
    // (name, JSON-of-args) twice, we return the cached result instead of
    // re-dispatching. Mirrors the pattern from lib/llm/heroku.ts.
    const toolResultCache = new Map<string, { modelText: string; isError: boolean }>();

    // Stream one model turn, accumulating content + tool calls.
    const inflightCalls = new Map<
      number,
      { id: string; name: string; argsJson: string }
    >();
    let turnText = "";
    let stopReason: string | null = null;

    try {
      for await (const ev of streamHeroku({
        tier: "reasoning",
        system,
        messages,
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        toolChoice: toolDefs.length > 0 ? "auto" : undefined,
        // Reasoning models need headroom — a short budget gets consumed
        // by hidden thinking before any output arrives. Confirmed in T0-3.
        maxTokens: 4000,
        signal,
      })) {
        if (ev.type === "token") {
          turnText += ev.text;
          accumulatedText += ev.text;
          yield { type: "token", text: ev.text };
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
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield { type: "error", message };
      return;
    }

    // Collect ordered, complete tool calls.
    const calls = [...inflightCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v)
      .filter((c) => c.name);

    // Append an assistant-content block for whatever prose came out.
    if (turnText) {
      contentBlocks.push({ type: "text", text: turnText });
    }

    if (calls.length === 0) {
      // Model finished without tools — this is the final turn.
      const finalText = turnText.trim() || accumulatedText.trim();
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

    // Record the assistant turn (with tool_calls) before dispatching.
    // Heroku Inference requires non-null assistant content with tool_calls,
    // so we fall back to a single space if the model emitted no prose.
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

    // Dispatch all tool calls in parallel.
    const dispatches = calls.map(async (c) => {
      // Reject hallucinated names synthetically — mirror the Today-side
      // defense without trusting that the SDK would catch it for us.
      if (!visibleNames.has(c.name)) {
        const body = {
          error: "unknown tool",
          message: `Tool "${c.name}" is not available. Use one of: ${[...visibleNames].join(", ")}.`,
        };
        return {
          callId: c.id,
          name: c.name,
          isError: true,
          modelText: JSON.stringify(body),
          preview: `Unknown tool: ${c.name}`,
        };
      }

      // Dedup cache check.
      const cacheKey = `${c.name}|${c.argsJson}`;
      const cached = toolResultCache.get(cacheKey);
      if (cached) {
        return {
          callId: c.id,
          name: c.name,
          isError: cached.isError,
          modelText: cached.modelText,
          preview: cached.modelText.slice(0, 200),
        };
      }

      let args: Record<string, unknown> = {};
      try {
        args = c.argsJson ? (JSON.parse(c.argsJson) as Record<string, unknown>) : {};
      } catch {
        args = {};
      }
      const r = await mcp.callTool(c.name, args);
      toolResultCache.set(cacheKey, {
        modelText: r.modelText,
        isError: r.isError,
      });
      return {
        callId: c.id,
        name: c.name,
        isError: r.isError,
        modelText: r.modelText,
        preview: r.textPreview,
      };
    });

    // Announce + await in one pass so the UI sees live call-start rows
    // before we block on the tool result.
    for (const c of calls) {
      let parsed: unknown = {};
      try {
        parsed = c.argsJson ? JSON.parse(c.argsJson) : {};
      } catch {
        parsed = { _raw: c.argsJson };
      }
      yield { type: "tool_call", callId: c.id, name: c.name, input: parsed };
      // tool_use block in the persisted content array
      contentBlocks.push({
        type: "tool_use",
        id: c.id,
        name: c.name,
        input: parsed,
      });
    }
    const results = await Promise.all(dispatches);

    for (const r of results) {
      yield {
        type: "tool_result",
        callId: r.callId,
        name: r.name,
        isError: r.isError,
        preview: r.preview,
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

      if (r.isError) consecutiveErrors += 1;
      else consecutiveErrors = 0;
    }

    if (consecutiveErrors >= ERROR_CIRCUIT_THRESHOLD) {
      const msg = `MCP dispatch failed ${consecutiveErrors} times in a row. Stopping to avoid a runaway loop.`;
      yield { type: "error", message: msg };
      const finalText =
        accumulatedText.trim() ||
        "I hit repeated errors trying to reach Data Cloud and couldn't complete this question.";
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

    // Loop — Kimi will now see the tool results and either emit text or
    // call more tools.
    if (stopReason && stopReason !== "tool_calls") {
      // Defensive: if upstream reports a non-tool stop reason alongside
      // tool calls, we still dispatched but won't loop indefinitely.
    }
  }

  // Hit iteration cap without a clean finish.
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

/**
 * Convert an MCP tool schema into an OpenAI function-tool envelope.
 */
function toOpenAiTool(t: SelfDcToolDef): ChatCompletionTool {
  // OpenAI requires a JSON-schema-ish object for parameters. The MCP
  // already provides one — defensively fill in `properties: {}` if empty.
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
