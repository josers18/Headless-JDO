/**
 * lib/llm/provider.ts — unified agent runner.
 *
 * Primary: Claude via Heroku Managed Inference (`INFERENCE_*`).
 * Fallback: optional second deployment (`HEROKU_INFERENCE_ONYX_*`, e.g. Kimi)
 * only if the primary run throws — see `agent.inference.heroku.fallback_kimi`.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { connectMcpClients } from "@/lib/mcp/client";
import { runAgent, type AgentEvent, type AgentRunResult } from "./heroku";
import type { McpServerName } from "@/types/horizon";
import {
  isOnyxInferenceConfigured,
  modelIdFor,
  resolveInferenceBackend,
  type InferenceBackend,
} from "./inferenceClients";
import { log } from "@/lib/log";

export type { InferenceBackend } from "./inferenceClients";

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
  /** Optional label for logs (no longer selects a model — primary is always Claude). */
  routeHint?: string;
  /** Force `"onyx"` for Kimi-only runs (tests). Omit for Claude primary + optional Kimi fallback. */
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
  /** Inference stack that completed this run (usually `heroku`; `onyx` if Kimi fallback succeeded). */
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
  const requested = resolveInferenceBackend({
    inferenceBackend: input.inferenceBackend,
    routeHint: input.routeHint,
  });

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
    if (requested === "onyx") {
      log.info("agent.inference.kimi_only", {
        routeHint: input.routeHint ?? "",
        model: modelIdFor("onyx"),
      });
      return withInferenceBackend(await runOnce("onyx"), "onyx");
    }

    try {
      return withInferenceBackend(await runOnce("heroku"), "heroku");
    } catch (primaryErr) {
      if (!isOnyxInferenceConfigured()) throw primaryErr;
      const reason =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      log.warn("agent.inference.heroku.fallback_kimi", {
        routeHint: input.routeHint ?? "",
        error: reason.slice(0, 500),
      });
      return withInferenceBackend(await runOnce("onyx"), "onyx");
    }
  } finally {
    await registry.close();
  }
}
