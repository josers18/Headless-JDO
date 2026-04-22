/**
 * lib/llm/provider.ts — LLM provider selection + unified agent runner.
 *
 * Primary path: `LLM_PROVIDER=heroku` — same process, but per-request
 * `inferenceBackend` can be `heroku` (Claude via Heroku Inference) or
 * `kimi` (Moonshot Kimi K2) when `KIMI_API_KEY` + `routeHint` match
 * `KIMI_ROUTES`. Anthropic direct (`LLM_PROVIDER=anthropic`) stays a
 * separate fallback and is not wired through `runAgentWithMcp`.
 *
 * Callers use `runAgentWithMcp` and pass optional `routeHint`.
 */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { connectMcpClients } from "@/lib/mcp/client";
import { runAgent, type AgentEvent } from "./heroku";
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
   * When set, steers the agent to Heroku Inference vs Moonshot Kimi
   * (see KIMI_API_KEY, KIMI_ROUTES in .env). Example: "signals", "pulse-strip".
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
  if (inferenceBackend === "kimi") {
    log.info("agent.inference.kimi", {
      routeHint: input.routeHint ?? "",
      model: modelIdFor("kimi"),
    });
  }

  const registry = await connectMcpClients({
    salesforceToken: input.salesforceToken,
  });
  try {
    const result = await runAgent({
      system: input.system,
      messages: input.messages,
      registry,
      onEvent: input.onEvent,
      maxIterations: input.maxIterations,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      forceFirstToolCall: input.forceFirstToolCall,
      inferenceBackend,
    });
    return result;
  } finally {
    await registry.close();
  }
}
