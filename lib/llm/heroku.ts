/**
 * lib/llm/heroku.ts — Heroku Inference agent loop (Claude 4.5 Sonnet).
 *
 * Heroku's Managed Inference exposes an OpenAI-compatible
 * /v1/chat/completions endpoint. This file orchestrates the tool-calling
 * loop against an `McpRegistry`:
 *
 *   user prompt → Claude → [tool_calls?]
 *     → execute via MCP registry in parallel
 *     → feed results back as `role: "tool"` messages
 *     → repeat until Claude returns a plain assistant message
 *
 * Streaming is implemented via a simple async callback (`onEvent`) so the
 * API routes can re-emit each step as an SSE frame.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { McpRegistry } from "@/lib/mcp/client";
import { toOpenAiTools, parseToolName } from "@/lib/mcp/tools";
import type { McpServerName } from "@/types/horizon";
import { requireEnv } from "@/lib/utils";

export interface AgentEvent {
  type:
    | "text_delta"
    | "tool_use"
    | "tool_result"
    | "iteration_start"
    | "final"
    | "error";
  text?: string;
  server?: McpServerName;
  tool?: string;
  input?: unknown;
  preview?: string;
  is_error?: boolean;
  iteration?: number;
  message?: string;
}

export interface AgentRunArgs {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  registry: McpRegistry;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  onEvent?: (e: AgentEvent) => void;
}

export interface AgentRunResult {
  text: string;
  toolCalls: Array<{
    server: McpServerName;
    tool: string;
    input: unknown;
    isError: boolean;
    preview: string;
  }>;
  iterations: number;
}

let _openai: OpenAI | null = null;
function openai(): OpenAI {
  if (_openai) return _openai;
  const base = requireEnv("INFERENCE_URL").replace(/\/$/, "");
  _openai = new OpenAI({
    apiKey: requireEnv("INFERENCE_KEY"),
    baseURL: `${base}/v1`,
  });
  return _openai;
}

export function herokuModel(): string {
  return process.env.INFERENCE_MODEL_ID ?? "claude-4-5-sonnet";
}

// Schema-mismatch signature. We trip a circuit breaker on these because
// (a) they mean the model fabricated a column/table, and (b) letting it
// retry produces an identical failure — a waste of Flex credits and a
// demo-ruining cascade of red rows in the reasoning trail. See user
// feedback 2026-04-19: the hygiene prompt alone wasn't enough.
const SCHEMA_ERROR_PATTERNS = [
  /invalid_argument/i,
  /unknown column/i,
  /unknown table/i,
  /does not exist/i,
  /no such column/i,
  /malformed_query/i,
  /unexpected token/i,
] as const;

function isSchemaMismatchError(preview: string | undefined | null): boolean {
  if (!preview) return false;
  return SCHEMA_ERROR_PATTERNS.some((re) => re.test(preview));
}

// Threshold for the breaker. One miss is understandable (rare DMO, custom
// field the model hadn't seen in training). Two misses in the same run
// from the same tool means the model is flailing — block further calls
// to that tool for the rest of the turn.
const SCHEMA_BREAKER_THRESHOLD = 2;

// Synthetic response injected in place of a blocked tool call. Phrased
// as a tool result the model will actually respect — "blocked" plus a
// concrete next-step instruction.
function blockedToolPayload(server: string, tool: string): string {
  return JSON.stringify({
    blocked: true,
    server,
    tool,
    reason:
      "Circuit breaker tripped: this tool returned repeated schema-mismatch errors in this turn. Further calls are disabled.",
    instruction:
      "Do NOT retry this tool for the rest of this turn. Stop invoking it and proceed with whatever data you already have from other tools. If you have no data, return a concise summary saying the source was unavailable — do not fabricate numbers.",
  });
}

/**
 * Run the full tool-calling loop, non-streaming. Streaming is opt-in via
 * onEvent: we emit tool_use / tool_result / text_delta events as they happen.
 */
export async function runAgent(args: AgentRunArgs): Promise<AgentRunResult> {
  const {
    system,
    messages: seed,
    registry,
    maxIterations = 10,
    temperature = 0.3,
    maxTokens = 4096,
    onEvent = () => {},
  } = args;

  const toolDefs = await registry.listAllTools();
  const tools = toOpenAiTools(toolDefs);

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...seed.map((m) => ({ role: m.role, content: m.content })),
  ];

  const collectedCalls: AgentRunResult["toolCalls"] = [];
  let iteration = 0;
  let finalText = "";
  // why: if the loop hits maxIterations, we still want to surface whatever
  // prose the model produced in its LAST assistant turn instead of throwing
  // that away. We keep a running copy here.
  let lastAssistantText = "";
  const model = herokuModel();

  // Per-run circuit breaker state. Keyed by `${server}.${tool}` so we can
  // block one data_360 tool without blocking the whole server.
  const schemaErrorCount = new Map<string, number>();
  const blockedTools = new Set<string>();

  for (iteration = 1; iteration <= maxIterations; iteration++) {
    onEvent({ type: "iteration_start", iteration });

    // why: stream=true gives us text deltas AND lets us watch tool_calls build
    // up incrementally. We still need to fully drain before executing, so we
    // accumulate into a single assistant message.
    const stream = await openai().chat.completions.create({
      model,
      messages,
      tools: tools.length > 0 ? tools : undefined,
      tool_choice: tools.length > 0 ? "auto" : undefined,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    });

    let assistantContent = "";
    const pendingCalls = new Map<
      number,
      {
        id: string;
        name: string;
        argsJson: string;
      }
    >();

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        assistantContent += delta.content;
        onEvent({ type: "text_delta", text: delta.content });
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = pendingCalls.get(idx) ?? {
            id: "",
            name: "",
            argsJson: "",
          };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name = tc.function.name;
          if (tc.function?.arguments) prev.argsJson += tc.function.arguments;
          pendingCalls.set(idx, prev);
        }
      }
    }

    lastAssistantText = assistantContent;

    const calls = [...pendingCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, v]) => v)
      .filter((c) => c.name);

    // No tool calls → assistant is done.
    if (calls.length === 0) {
      finalText = assistantContent.trim();
      onEvent({ type: "final", text: finalText });
      return { text: finalText, toolCalls: collectedCalls, iterations: iteration };
    }

    // Record the assistant turn with the tool_calls before we execute them.
    //
    // why: Heroku Inference's /v1/chat/completions wrapper rejects a null,
    // omitted, or empty-string `content` on assistant messages with
    // tool_calls ("400 messages[N]: content is required"). OpenAI direct
    // accepts null; Heroku does not. So we ALWAYS pass a non-empty string,
    // falling back to a tiny placeholder when Claude emitted no prose for
    // this turn. Claude ignores placeholder content on assistant turns with
    // tool_calls, so this doesn't pollute the conversation.
    messages.push({
      role: "assistant",
      content: assistantContent || " ",
      tool_calls: calls.map((c) => ({
        id: c.id || cryptoRandomId(),
        type: "function" as const,
        function: { name: c.name, arguments: c.argsJson || "{}" },
      })),
    });

    // Execute in parallel, but gate each call through the circuit breaker.
    // Blocked calls skip the network hop entirely and return a synthetic
    // payload that steers the model toward a different plan.
    const results = await Promise.all(
      calls.map(async (c) => {
        const parsed = parseToolName(c.name);
        const server = parsed?.server ?? "salesforce_crm";
        const tool = parsed?.name ?? c.name;
        const key = `${server}.${tool}`;
        let argObj: Record<string, unknown> = {};
        try {
          argObj = c.argsJson ? JSON.parse(c.argsJson) : {};
        } catch (e) {
          return {
            c,
            server,
            tool,
            argObj: {},
            result: {
              server,
              tool,
              isError: true,
              content: null,
              textPreview: `bad JSON from model: ${String(e)}`,
            },
          };
        }

        // Circuit breaker — short-circuit repeated schema mismatches.
        // We still emit tool_use/tool_result events so the reasoning trail
        // shows that the call was attempted and silenced.
        if (blockedTools.has(key)) {
          onEvent({ type: "tool_use", server, tool, input: argObj });
          const blockedPreview = blockedToolPayload(server, tool);
          onEvent({
            type: "tool_result",
            server,
            tool,
            preview: "blocked by schema-mismatch breaker",
            is_error: true,
          });
          return {
            c,
            server,
            tool,
            argObj,
            result: {
              server: server as McpServerName,
              tool,
              isError: true,
              content: null,
              textPreview: blockedPreview,
            },
          };
        }

        onEvent({
          type: "tool_use",
          server,
          tool,
          input: argObj,
        });
        const result = await registry.callTool(c.name, argObj);
        onEvent({
          type: "tool_result",
          server: result.server,
          tool: result.tool,
          preview: result.textPreview,
          is_error: result.isError,
        });

        // Trip the breaker on schema-mismatch errors.
        if (
          result.isError &&
          isSchemaMismatchError(result.textPreview)
        ) {
          const n = (schemaErrorCount.get(key) ?? 0) + 1;
          schemaErrorCount.set(key, n);
          if (n >= SCHEMA_BREAKER_THRESHOLD) {
            blockedTools.add(key);
          }
        }

        return { c, server, tool, argObj, result };
      })
    );

    // Push one `role: "tool"` message per call, in the same order as tool_calls.
    for (const r of results) {
      collectedCalls.push({
        server: r.result.server,
        tool: r.result.tool,
        input: r.argObj,
        isError: r.result.isError,
        preview: r.result.textPreview,
      });
      messages.push({
        role: "tool",
        tool_call_id: r.c.id || "unknown",
        // why: Heroku Inference rejects empty tool-result content the same
        // way it rejects empty assistant content. An MCP tool can legitimately
        // return an empty-string preview (e.g. a successful void write), so
        // we substitute a minimal summary so the model still sees the
        // call-happened signal.
        content:
          r.result.textPreview && r.result.textPreview.length > 0
            ? r.result.textPreview
            : r.result.isError
              ? "(tool error with empty content)"
              : "(tool call succeeded with no output)",
      });
    }
    // Loop continues — Claude reads the tool results and decides next action.
  }

  // Hit iteration cap without a clean finish. Surface whatever prose the
  // model produced in its final turn rather than dropping the run on the
  // floor. We still log a soft `error` event so operators can see the cap
  // was hit, but the user-visible text is the best-effort narrative.
  finalText = (lastAssistantText || finalText).trim();
  onEvent({
    type: "error",
    message: `exceeded max iterations (${maxIterations}) — returning best-effort narrative`,
  });
  onEvent({
    type: "final",
    text: finalText || "(agent exceeded iteration cap without final answer)",
  });
  return {
    text: finalText || "(agent exceeded iteration cap without final answer)",
    toolCalls: collectedCalls,
    iterations: iteration - 1,
  };
}

function cryptoRandomId(): string {
  // Node 18+ has globalThis.crypto.randomUUID.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `tc_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}
