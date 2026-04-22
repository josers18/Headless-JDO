/**
 * lib/llm/provider.ts — LLM provider selection + unified agent runner.
 *
 * Primary path: `LLM_PROVIDER=heroku` — per-request `inferenceBackend` can be
 * `heroku` (INFERENCE_*) or `onyx` (HEROKU_INFERENCE_ONYX_*) when `routeHint`
 * matches `HEROKU_INFERENCE_ONYX_ROUTES`. Same OpenAI-compatible chat API.
 * If Onyx throws before the run completes, we retry once on the primary
 * Heroku Inference endpoint (`agent.inference.onyx.fallback` in logs).
 * Anthropic direct (`LLM_PROVIDER=anthropic`) is not wired through here.
 *
 * Callers use `runAgentWithMcp` and pass optional `routeHint`.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { connectMcpClients } from "@/lib/mcp/client";
import { runAgent, type AgentEvent, type AgentRunResult } from "./heroku";
import type { McpServerName } from "@/types/horizon";
import {
  modelIdFor,
  resolveInferenceBackend,
  type InferenceBackend,
} from "./inferenceClients";
import { log } from "@/lib/log";

export type LlmProvider = "heroku" | "anthropic";

export type { InferenceBackend } from "./inferenceClients";

export function currentProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER ?? "heroku").toLowerCase();
  return p === "anthropic" ? "anthropic" : "heroku";
}

export interface RunAgentInput {
  system: string;
  messages: ChatCompletionMessageParam[];
  salesforceToken: string;
  onEvent?: (e: AgentEvent) => void;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  /** See `AgentRunArgs.forceFirstToolCall` in lib/llm/heroku.ts. */
  forceFirstToolCall?: boolean;
  /**
   * When set, steers primary vs Onyx Heroku Inference (see
   * HEROKU_INFERENCE_ONYX_* in .env). Example: "signals", "pulse-strip".
   */
  routeHint?: string;
  /**
   * Force a specific backend; normally leave unset and use `routeHint` + env.
   */
  inferenceBackend?: InferenceBackend;
}

export interface RunAgentOutput {
  text: string;
  toolCalls: Array<{
    server: McpServerName;
    tool: string;
    input: unknown;
    isError: boolean;
    preview: string;
  }>;
  iterations: number;
  transcript: ChatCompletionMessageParam[];
  /** Inference stack that completed this run (`heroku` primary after Onyx fallback). */
  inferenceBackend: InferenceBackend;
}

function withInferenceBackend(
  result: AgentRunResult,
  inferenceBackend: InferenceBackend
): RunAgentOutput {
  return { ...result, inferenceBackend };
}

/**
 * Opens MCP connections, runs the agent loop, closes MCP connections. Events
 * (text deltas, tool_use, tool_result) are re-emitted via `onEvent` — wire
 * these straight into an SSE stream.
 */
export async function runAgentWithMcp(
  input: RunAgentInput
): Promise<RunAgentOutput> {
  const provider = currentProvider();
  if (provider === "anthropic") {
    throw new Error(
      "LLM_PROVIDER=anthropic path not implemented via runAgentWithMcp. " +
        "Use lib/anthropic/client.ts#askStream directly, or switch to 'heroku'."
    );
  }

  const inferenceBackend = resolveInferenceBackend({
    inferenceBackend: input.inferenceBackend,
    routeHint: input.routeHint,
  });
  if (inferenceBackend === "onyx") {
    log.info("agent.inference.onyx", {
      routeHint: input.routeHint ?? "",
      model: modelIdFor("onyx"),
    });
  }

  const registry = await connectMcpClients({
    salesforceToken: input.salesforceToken,
  });

  const runOnce = (backend: InferenceBackend) =>
    runAgent({
      system: input.system,
      messages: input.messages,
      registry,
      onEvent: input.onEvent,
      maxIterations: input.maxIterations,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      forceFirstToolCall: input.forceFirstToolCall,
      inferenceBackend: backend,
    });

  try {
    if (inferenceBackend !== "onyx") {
      return withInferenceBackend(
        await runOnce(inferenceBackend),
        inferenceBackend
      );
    }
    try {
      return withInferenceBackend(await runOnce("onyx"), "onyx");
    } catch (firstErr) {
      const reason =
        firstErr instanceof Error ? firstErr.message : String(firstErr);
      log.warn("agent.inference.onyx.fallback", {
        routeHint: input.routeHint ?? "",
        error: reason.slice(0, 500),
      });
      // Do not emit AgentEvent type "error" here — `useAgentStream` treats it
      // as a terminal failure and would break the UI while primary still runs.
      return withInferenceBackend(await runOnce("heroku"), "heroku");
    }
  } finally {
    await registry.close();
  }
}
