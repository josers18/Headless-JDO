import type { ReasoningStep, McpServerName } from "@/types/horizon";
import type { AskThreadMessage } from "@/types/ask-thread";
import {
  modelIdFor,
  type InferenceBackend,
} from "@/lib/llm/inferenceClients";
import {
  readCachedSection,
  writeCachedSection,
} from "@/lib/sse/sectionCache";

export type SseEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; server: McpServerName; tool: string; input: unknown }
  | {
      type: "tool_result";
      server: McpServerName;
      tool: string;
      is_error?: boolean;
      preview: string;
      /** Approx token size of the result the model ingested (estimate). */
      resultTokens?: number;
    }
  | {
      type: "iteration_usage";
      iteration: number;
      inputTokens: number;
      outputTokens: number;
      exact: boolean;
    }
  | {
      type: "inference_meta";
      backend: InferenceBackend;
      model: string;
    }
  | {
      type: "usage_meta";
      usage: {
        model: string;
        inputTokens: number;
        outputTokens: number;
        exact: boolean;
      };
    }
  | { type: "reasoning"; step: ReasoningStep }
  | { type: "thread_snapshot"; messages: AskThreadMessage[] }
  | { type: "done" }
  | { type: "error"; message: string };

/** Emit once after `runAgentWithMcp` so clients can show which stack ran. */
export function sendInferenceMeta(
  send: (e: SseEvent) => void,
  backend: InferenceBackend
): void {
  send({
    type: "inference_meta",
    backend,
    model: modelIdFor(backend),
  });
}

/** Emit this run's token usage so the panel can bump live. */
export function sendUsageMeta(
  send: (e: SseEvent) => void,
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    exact: boolean;
  }
): void {
  send({ type: "usage_meta", usage });
}

/**
 * Forward a main-stack AgentEvent to the SSE stream. Replaces the identical
 * inline `onEvent` branches that lived in every agent route — wire the agent's
 * events to the client in ONE place. Pass it as the route's `onEvent`:
 *
 *   onEvent: (e) => forwardAgentEvent(send, e)
 *
 * Returns nothing; unknown / lifecycle-only event types (iteration_start,
 * final) are intentionally not forwarded.
 */
export function forwardAgentEvent(
  send: (e: SseEvent) => void,
  e: import("@/lib/llm/heroku").AgentEvent
): void {
  if (e.type === "text_delta" && e.text) {
    send({ type: "text_delta", text: e.text });
  } else if (e.type === "tool_use" && e.server && e.tool) {
    send({ type: "tool_use", server: e.server, tool: e.tool, input: e.input });
  } else if (e.type === "tool_result" && e.server && e.tool) {
    send({
      type: "tool_result",
      server: e.server,
      tool: e.tool,
      is_error: e.is_error,
      preview: e.preview ?? "",
      ...(typeof e.resultTokens === "number"
        ? { resultTokens: e.resultTokens }
        : {}),
    });
  } else if (e.type === "iteration_usage" && e.iterationUsage) {
    send({
      type: "iteration_usage",
      iteration: e.iterationUsage.iteration,
      inputTokens: e.iterationUsage.inputTokens,
      outputTokens: e.iterationUsage.outputTokens,
      exact: e.iterationUsage.exact,
    });
  } else if (e.type === "usage_meta" && e.usage) {
    send({ type: "usage_meta", usage: e.usage });
  } else if (
    e.type === "error" &&
    typeof e.message === "string" &&
    e.message.length > 0
  ) {
    send({ type: "error", message: e.message });
  }
}

export function sseEncode(event: SseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function makeSseStream(
  writer: (send: (e: SseEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // See makeCacheableSseStream below for the rationale on guarding
      // every controller op — once the client navigates away mid-stream
      // controller.enqueue / .close throw "Invalid state" and the
      // resulting unhandled rejection chain pollutes the logs.
      let controllerClosed = false;
      const send = (e: SseEvent): void => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(e)));
        } catch {
          controllerClosed = true;
        }
      };
      const safeClose = (): void => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {
          /* already closed by Next when the client disconnected */
        }
      };
      try {
        await writer(send);
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: bankerFacingErrorMessage(err),
        });
      } finally {
        safeClose();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

/**
 * Cache-aware SSE stream wrapper. On a hit, replays the persisted
 * event sequence without running the writer. On a miss (or bypass),
 * runs the writer, captures every event, and persists on success.
 *
 * Caller supplies the cache key components (route, bankerUserId,
 * localDay) so the cache rolls over at the banker's local midnight,
 * not UTC. `bypass: true` (typically driven by ?refresh=1) skips the
 * read so a banker-initiated refresh bypasses stale data.
 *
 * Failure mode: any cache read/write error degrades to live behavior.
 * Errors thrown by the writer are NOT cached — the next load retries.
 */
export function makeCacheableSseStream(
  cacheKey: {
    route: string;
    bankerUserId: string;
    localDay: string;
    bypass?: boolean;
  },
  writer: (send: (e: SseEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Guarded send. Once the underlying response is canceled (client
      // navigated away, network died, etc.) controller.enqueue throws
      // "Invalid state: Controller is already closed". We swallow that
      // here so the writer keeps running cleanly to completion AND so
      // we can tell at write-cache-decision time whether the stream was
      // healthy. closedDueToError is set when controller.enqueue throws
      // for ANY reason (including cancellation) so we never persist a
      // partial sequence to the daily cache.
      let controllerClosed = false;
      let closedDueToError = false;
      const safeSend = (e: SseEvent): void => {
        if (controllerClosed) return;
        try {
          controller.enqueue(encoder.encode(sseEncode(e)));
        } catch {
          // Most common: client disconnected and the underlying stream
          // is canceled. Mark the controller as gone so we don't keep
          // hammering it, and DON'T cache — the captured sequence is
          // a partial agent run and replaying it would render broken.
          controllerClosed = true;
          closedDueToError = true;
        }
      };
      const safeClose = (): void => {
        if (controllerClosed) return;
        controllerClosed = true;
        try {
          controller.close();
        } catch {
          /* already closed by Next when the client disconnected */
        }
      };

      const replayCached = async (): Promise<boolean> => {
        if (cacheKey.bypass) return false;
        const cached = await readCachedSection(
          cacheKey.route,
          cacheKey.bankerUserId,
          cacheKey.localDay
        );
        if (!cached) return false;
        for (const e of cached.events) safeSend(e);
        safeSend({ type: "done" });
        return true;
      };

      const captured: SseEvent[] = [];
      let sawTextDelta = false;
      let writerThrew = false;

      try {
        const replayed = await replayCached();
        if (replayed) {
          safeClose();
          return;
        }
        const capturingSend = (e: SseEvent) => {
          if (e.type === "text_delta") sawTextDelta = true;
          captured.push(e);
          safeSend(e);
        };
        await writer(capturingSend);
        safeSend({ type: "done" });
      } catch (err) {
        writerThrew = true;
        safeSend({
          type: "error",
          message: bankerFacingErrorMessage(err),
        });
      } finally {
        safeClose();
      }

      // Cache write contract — three guards must all hold:
      //   1. writer didn't throw,
      //   2. controller wasn't torn down mid-stream (client disconnect),
      //   3. at least one text_delta event was emitted. The agent
      //      sometimes finishes without producing prose (maxIterations
      //      hit during a tool-call iteration, or an early-exit path).
      //      Caching a sequence with only tool_use / tool_result events
      //      replays as an empty narrative on the next load — broken
      //      JSON parse on the client. Require text_delta presence.
      const safeToPersist =
        !writerThrew &&
        !closedDueToError &&
        sawTextDelta &&
        captured.length > 0;
      if (safeToPersist) {
        void writeCachedSection(
          cacheKey.route,
          cacheKey.bankerUserId,
          cacheKey.localDay,
          captured
        );
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}

/**
 * Translate raw thrown errors from the agent loop (Heroku Inference
 * 429s, Salesforce MCP 5xx, network timeouts, etc.) into a single
 * short sentence that a banker can read without seeing infra detail.
 *
 * The raw error is always logged server-side via lib/log.ts; this
 * function is only about what the USER sees when a section-level
 * request falls over. We never want a raw body like
 *   "429 rate Limit: maximum tokens per minute reached. Quota: 800000..."
 * to render as the card's body text.
 */
function bankerFacingErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Heroku Managed Inference rate-limit shape — covers both
  // tokens-per-minute (TPM) and requests-per-minute (RPM) caps.
  // The model is temporarily over quota; a retry in ~60s succeeds.
  if (
    /\b429\b/.test(raw) ||
    /rate[\s_]?limit/i.test(raw) ||
    /tokens?\s+per\s+minute/i.test(raw) ||
    /quota/i.test(raw)
  ) {
    return "The analytics engine is catching up on other requests. Try again in a moment.";
  }

  // Salesforce / MCP auth expiry.
  if (
    /\b401\b/.test(raw) ||
    /INVALID_SESSION_ID/i.test(raw) ||
    /session\s+expired/i.test(raw)
  ) {
    return "Your Salesforce session expired. Reconnect from the top-right menu to continue.";
  }

  // Salesforce / MCP downstream errors.
  if (
    /\b(5\d{2})\b/.test(raw) ||
    /ECONN(REFUSED|RESET)|ETIMEDOUT|ENOTFOUND/i.test(raw)
  ) {
    return "A connected system is temporarily unavailable. Please try again.";
  }

  // Heroku dyno request-timeout (H12) — we exceeded 30s on the route.
  if (/\bH12\b/.test(raw) || /timed?[\s_]?out/i.test(raw)) {
    return "That request took longer than expected to complete. Please try again.";
  }

  // Default: something genuinely unexpected. Keep the message brief
  // and reassuring — the real detail is in the server logs.
  return "Something went wrong on our side. Please try again.";
}
