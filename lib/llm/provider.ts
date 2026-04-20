/**
 * lib/llm/provider.ts — LLM provider selection + unified agent runner.
 *
 * Horizon currently ships with two providers, selected by env:
 *   - `heroku`  (default): Heroku Inference (Claude 4.5 Sonnet), OpenAI-
 *                          compatible. We drive the MCP tool loop ourselves.
 *   - `anthropic`          : Anthropic direct, native `mcp_servers`. Kept as
 *                            a fallback for when Anthropic billing resolves.
 *
 * Callers use `runAgentWithMcp` and never touch provider internals.
 */

import { connectMcpClients } from "@/lib/mcp/client";
import { runAgent, type AgentEvent } from "./heroku";
import type { McpServerName } from "@/types/horizon";

export type LlmProvider = "heroku" | "anthropic";

export function currentProvider(): LlmProvider {
  const p = (process.env.LLM_PROVIDER ?? "heroku").toLowerCase();
  return p === "anthropic" ? "anthropic" : "heroku";
}

export interface RunAgentInput {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  salesforceToken: string;
  onEvent?: (e: AgentEvent) => void;
  maxIterations?: number;
  temperature?: number;
  maxTokens?: number;
  /** See `AgentRunArgs.forceFirstToolCall` in lib/llm/heroku.ts. */
  forceFirstToolCall?: boolean;
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
    });
    return result;
  } finally {
    await registry.close();
  }
}
