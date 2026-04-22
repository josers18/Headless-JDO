import type { ReasoningStep, McpServerName } from "@/types/horizon";
import type { AskThreadMessage } from "@/types/ask-thread";

export type SseEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; server: McpServerName; tool: string; input: unknown }
  | {
      type: "tool_result";
      server: McpServerName;
      tool: string;
      is_error?: boolean;
      preview: string;
    }
  | { type: "reasoning"; step: ReasoningStep }
  | { type: "thread_snapshot"; messages: AskThreadMessage[] }
  | { type: "done" }
  | { type: "error"; message: string };

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
      const send = (e: SseEvent) =>
        controller.enqueue(encoder.encode(sseEncode(e)));
      try {
        await writer(send);
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: bankerFacingErrorMessage(err),
        });
      } finally {
        controller.close();
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
