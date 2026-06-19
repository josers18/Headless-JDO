/**
 * Ask My Data agent loop — orchestrates Kimi K2 Thinking against the
 * first-party Salesforce-hosted Data 360 MCP. Deliberately isolated from
 * lib/llm/heroku.ts; re-uses the same OpenAI-compatible tool-call semantics
 * but owns its own vocabulary, tool-filter policy, dedup cache, and error
 * handling so Today's loop can evolve without collateral damage here.
 *
 * Yields normalized events via an async generator:
 *   - tokens (assistant prose deltas)
 *   - tool_call (banker-visible reasoning trail row: the agent invoked X)
 *   - tool_result (trail row: response preview)
 *   - turn_complete (final assistant text + tool-use/tool-result blocks,
 *                    ready to persist as an assistant message)
 *
 * The first-party MCP exposes two tools — `get_dc_metadata` (list DLOs +
 * full schema) and `post_dc_query_sql` (ANSI SQL). Kimi decides when to
 * call metadata vs. query on each turn; no catalog is preloaded
 * (Q-T1-3-b = A).
 */

import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";
import { streamHeroku } from "@/lib/inference/heroku";
import type {
  FirstPartyDcSession,
  FirstPartyDcToolDef,
} from "@/lib/mcp/firstPartyDataCloud";
import { stripThinkTags } from "@/lib/analyze/sanitize";

// Soft budget: if the agent hasn't answered after N tool-call iterations
// we bail. Heroku router already stalls long requests — this keeps us well
// under that window.
const MAX_ITERATIONS = 6;

// If the same error surfaces this many times in a row we stop dispatching
// to prevent runaway loops against a broken MCP.
// Trip on strike 2. Two consecutive MCP errors almost always mean the
// model is guessing column names (the usual failure mode on Data Cloud
// SQL). Tripping early keeps the reasoning trail clean for the banker
// and avoids the 3+ retry cascades we saw during v0.3 prompt testing.
const ERROR_CIRCUIT_THRESHOLD = 2;

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
  | { type: "error"; message: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
      model: string;
    };

export interface AskDataAgentOptions {
  /** System prompt. Kept tight (Q-T1-3-b = A). */
  system: string;
  /** Prior messages (user + assistant turns from DB), plus the new user turn. */
  messages: ChatCompletionMessageParam[];
  /** Open MCP session owned by the caller. */
  mcp: FirstPartyDcSession;
  /** Abort when the client disconnects. */
  signal?: AbortSignal;
  /**
   * When true, the DMO catalog was already appended to the system
   * prompt by the route. In that case we HIDE `get_dc_metadata` from
   * the model's tool list so it can't burn iterations re-discovering
   * what's already in context. This mirrors the Today flow's
   * `preloadedDcSnapshot` pattern in lib/llm/heroku.ts — same
   * invariant, same user benefit (1 SQL call instead of N metadata +
   * 1 SQL).
   */
  preloadedDcMetadata?: boolean;
}

/**
 * Runs the tool-call loop. Yields events as they're produced; the caller
 * forwards them to the SSE stream and persists the final content blocks.
 */
export async function* runAskDataAgent(
  options: AskDataAgentOptions
): AsyncGenerator<AskDataAgentEvent, void, unknown> {
  const { system, mcp, signal, preloadedDcMetadata = false } = options;

  // Build visible tool list once per session. MCP schemas come back as
  // JSON Schema; we wrap them in OpenAI's `function` tool envelope.
  //
  // When the route preloaded the DMO catalog into the system prompt,
  // hide `get_dc_metadata` — the model already has everything that
  // tool would return, and keeping the tool visible tempts Kimi to
  // "double-check" the catalog (4+ iterations we saw in screenshot
  // 16 before cache preload landed).
  const allTools = await mcp.listTools();
  const visibleTools = preloadedDcMetadata
    ? allTools.filter((t) => !/^get_dc_metadata$/i.test(t.name))
    : allTools;
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

  // No turn-wide budget on Ask My Data tools: unlike Analyze's
  // `analyze_data` (same question → same answer, so repeat calls are
  // hedging), both `get_dc_metadata` and `post_dc_query_sql` take
  // filter args — different args = different slices of the catalog
  // or different SQL queries, which are legitimate exploration. The
  // existing per-(name, argsJson) dedup in toolResultCache already
  // collapses exact-duplicate calls.

  // `<think>` stripper runs across token-stream chunks because tags
  // can span chunk boundaries. Without this, Kimi's internal
  // reasoning monologue ("<think> let me look for ...</think>")
  // rendered verbatim in the banker-facing UI.
  const thinkStripper = stripThinkTags();

  // Turn-wide tool result cache: dedup by (name, JSON-of-args) ACROSS
  // iterations, not just within one. Previously this lived inside the
  // loop and got cleared every iteration, which meant Kimi could call
  // `get_dc_metadata()` with identical args on iterations 1, 2, 3, 4
  // and hit the MCP four times. Moving the cache out of the loop
  // means identical-args repeats are served from memory — the MCP
  // runs once per (name, args) pair for the whole turn.
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
      // facing fallback so the UI renders something and follow-ups
      // still fire with non-empty context. Without this, Kimi
      // upstream errors (timeout, 429, bad gateway) produce a
      // silent empty response.
      if (!accumulatedText.trim()) {
        const fallback =
          "The data engine had trouble with that question. Try rephrasing, narrowing the scope, or asking again in a moment.";
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
      // Model finished without tools — this is the final turn. If
      // Kimi emitted no prose either (e.g. exhausted iterations or
      // was stumped by empty/error tool results), yield a banker-
      // facing fallback so the UI doesn't render a silent empty
      // response. Matches the analyze agent's fallback pattern.
      let finalText = turnText.trim() || accumulatedText.trim();
      if (!finalText) {
        finalText =
          "I couldn't find an answer in Data Cloud for that question. The data or metric you asked about may not exist in the available objects — try rephrasing, narrowing the scope, or asking about something more specific.";
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

    // Dispatch all tool calls in parallel. Exact-duplicate calls
    // (same name + same argsJson) are deduped via toolResultCache
    // below. Different args on the same tool are legitimate
    // exploration (e.g. get_dc_metadata with {entityCategory:
    // "Profile"} then {entityType: "DataModelObject"} — narrowing
    // the catalog search) and proceed normally.
    const dispatches = calls.map(async (c) => {
      // Reject hallucinated names synthetically — mirror the Today-side
      // defense without trusting that the SDK would catch it for us.
      if (!visibleNames.has(c.name)) {
        // Special case: `get_dc_metadata` is intentionally hidden when
        // the catalog is preloaded in the system prompt. Without this
        // branch, the model sees "unknown tool — use one of:
        // post_dc_query_sql" and is stuck — it genuinely wanted to
        // explore schema. Tell it to read the catalog block instead.
        const isHiddenMetadataTool =
          preloadedDcMetadata && /^get_dc_metadata$/i.test(c.name);
        const body = isHiddenMetadataTool
          ? {
              error: "catalog already preloaded",
              message:
                "The Data Cloud catalog (all DMOs + their fields) is " +
                "already in your system prompt. Reference it directly " +
                "to find tables and columns — no metadata tool call is " +
                "needed. Use post_dc_query_sql for the actual query.",
            }
          : {
              error: "unknown tool",
              message: `Tool "${c.name}" is not available. Use one of: ${[...visibleNames].join(", ")}.`,
            };
        return {
          callId: c.id,
          name: c.name,
          isError: true,
          isSyntheticGuard: true,
          modelText: JSON.stringify(body),
          preview: isHiddenMetadataTool
            ? "Catalog already in system prompt."
            : `Unknown tool: ${c.name}`,
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

      // Only real MCP failures feed the circuit breaker. Synthetic
      // guard rejections (unknown tool name) are model-behavior
      // corrections, not infrastructure failures — counting them
      // would trip the breaker against a threat we invented, killing
      // the turn with no banker-visible answer.
      const isSynthetic = (r as { isSyntheticGuard?: boolean }).isSyntheticGuard === true;
      if (r.isError && !isSynthetic) consecutiveErrors += 1;
      else if (!r.isError) consecutiveErrors = 0;
      // Synthetic errors leave the counter unchanged.
    }

    if (consecutiveErrors >= ERROR_CIRCUIT_THRESHOLD) {
      const msg = `MCP dispatch failed ${consecutiveErrors} times in a row. Stopping to avoid a runaway loop.`;
      yield { type: "error", message: msg };
      let finalText = accumulatedText.trim();
      if (!finalText) {
        // Banker-actionable fallback. The previous "I hit repeated
        // errors" wording left the banker with nothing to do; this
        // version names the likely root cause (schema mismatch) and
        // invites a narrower reframe.
        finalText =
          "I wasn't able to assemble the right query for that — the fields I expected don't line up across the relevant objects. Try narrowing the question (e.g. just the voice calls, or just the mortgage browsers) and I'll pull each piece cleanly.";
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

    // Loop — Kimi will now see the tool results and either emit text or
    // call more tools.
    if (stopReason && stopReason !== "tool_calls") {
      // Defensive: if upstream reports a non-tool stop reason alongside
      // tool calls, we still dispatched but won't loop indefinitely.
    }
  }

  // Hit iteration cap without a clean finish. Emit a token event
  // before turn_complete so the narrative actually renders — the
  // useAskDataStream hook builds the banker-visible narrative from
  // `token` events; `turn_complete` alone is a no-op for display.
  let finalText = accumulatedText.trim();
  if (!finalText) {
    finalText =
      "I ran out of steps before finishing this question — try a narrower ask.";
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
}

/**
 * Convert an MCP tool schema into an OpenAI function-tool envelope.
 */
function toOpenAiTool(t: FirstPartyDcToolDef): ChatCompletionTool {
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
