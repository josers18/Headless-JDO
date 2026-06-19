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
import {
  loadCachedDcMetadata,
  toDcSnapshot,
  toSystemPromptSection as toDcCatalogSection,
} from "@/lib/llm/dcMetadataCache";
import {
  loadCachedSdms,
  toSystemPromptSection as toSdmCatalogSection,
} from "@/lib/llm/tableauSemanticCache";
import { log } from "@/lib/log";
import { recordTokenUsage } from "@/lib/db/tokenUsage";

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
  /** Banker user id for token-spend attribution. */
  userId?: string;
  /** Login-session id (hz_sid) for token-spend scoping. */
  sessionId?: string;
  /** Route label for token-spend rows (e.g. "ask", "brief"). */
  route?: string;
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
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  };
}

function withInferenceBackend(
  result: AgentRunResult,
  inferenceBackend: InferenceBackend
): RunAgentOutput {
  return {
    ...result,
    inferenceBackend,
    usage: {
      model: modelIdFor(inferenceBackend),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      exact: result.usage.exact,
    },
  };
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

  // Preload both catalogs from Redis in parallel (each refreshed every
  // 12h by their respective scheduled jobs). When the DC cache is hit:
  //   - the SQL preflight starts strict on iteration 1
  //   - the metadata-before-SQL gate is pre-satisfied
  //   - get_dc_metadata is hidden from the model's tool list
  //   - a compact catalog block is appended to the system prompt
  // When the Tableau SDM cache is hit:
  //   - the SDM catalog is appended to the system prompt (apiNames,
  //     dimensions, measurements) so the model can call analyze_data
  //     directly without a list_semantic_models round-trip
  //   - list_semantic_models is hidden from the model's tool list
  // Either cache can be missing independently — graceful fallback to
  // live discovery in both cases.
  const [cachedDcMetadata, cachedSdms] = await Promise.all([
    loadCachedDcMetadata(),
    loadCachedSdms(),
  ]);
  if (cachedDcMetadata) {
    log.info("agent.dc_metadata.cache_hit", {
      routeHint: input.routeHint ?? "",
      dmos: cachedDcMetadata.survivingDmos,
      generatedAt: cachedDcMetadata.generatedAt,
    });
  }
  if (cachedSdms) {
    log.info("agent.tableau_sdms.cache_hit", {
      routeHint: input.routeHint ?? "",
      sdms: cachedSdms.survivingSdms,
      generatedAt: cachedSdms.generatedAt,
    });
  }
  const preloadedDcSnapshot = cachedDcMetadata
    ? toDcSnapshot(cachedDcMetadata)
    : undefined;
  const dcCatalogSection = toDcCatalogSection(cachedDcMetadata);
  const sdmCatalogSection = toSdmCatalogSection(cachedSdms);
  const extraSections = [dcCatalogSection, sdmCatalogSection].filter(
    (s) => s.length > 0
  );
  const systemWithCatalog =
    extraSections.length > 0
      ? `${input.system}\n\n${extraSections.join("\n\n")}`
      : input.system;

  const runOnce = (backend: InferenceBackend) =>
    runAgent({
      system: systemWithCatalog,
      messages: input.messages,
      registry,
      onEvent: input.onEvent,
      maxIterations: input.maxIterations,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
      forceFirstToolCall: input.forceFirstToolCall,
      inferenceBackend: backend,
      preloadedDcSnapshot,
      preloadedTableauSdms: Boolean(cachedSdms),
      preloadedSdmApiNames: cachedSdms?.sdms.map((s) => s.apiName),
    });

  const afterRun = (out: RunAgentOutput): RunAgentOutput => {
    // Live event for the main SSE stack (Ask Bar + sections) — instant
    // panel feedback before the DB refetch lands.
    input.onEvent?.({ type: "usage_meta", usage: out.usage });
    // Fire-and-forget persistence. A DB failure must never break a run.
    void recordTokenUsage({
      userId: input.userId ?? "unknown",
      sessionId: input.sessionId ?? "unknown",
      route: input.route ?? input.routeHint ?? "unknown",
      model: out.usage.model,
      inputTokens: out.usage.inputTokens,
      outputTokens: out.usage.outputTokens,
      exact: out.usage.exact,
    }).catch((e) =>
      log.warn("token_usage.write_failed", {
        route: input.route ?? input.routeHint ?? "unknown",
        error: e instanceof Error ? e.message : String(e),
      })
    );
    return out;
  };

  try {
    if (requested === "onyx") {
      log.info("agent.inference.kimi_only", {
        routeHint: input.routeHint ?? "",
        model: modelIdFor("onyx"),
      });
      return afterRun(withInferenceBackend(await runOnce("onyx"), "onyx"));
    }

    try {
      return afterRun(withInferenceBackend(await runOnce("heroku"), "heroku"));
    } catch (primaryErr) {
      if (!isOnyxInferenceConfigured()) throw primaryErr;
      const reason =
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
      log.warn("agent.inference.heroku.fallback_kimi", {
        routeHint: input.routeHint ?? "",
        error: reason.slice(0, 500),
      });
      return afterRun(withInferenceBackend(await runOnce("onyx"), "onyx"));
    }
  } finally {
    await registry.close();
  }
}
