/**
 * Ask My Data SSE protocol. Isolated from Today's lib/sse/stream.ts
 * (Q-T1-arch-c = A) so the new surface doesn't inherit every future
 * vocabulary change on the Today path. Client-side consumer lives in
 * lib/client/useAskDataStream.ts.
 */

export type AskDataSseEvent =
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
      type: "user_persisted";
      messageId: string;
    }
  | {
      type: "assistant_persisted";
      messageId: string;
    }
  | {
      type: "thread_title";
      title: string;
    }
  | {
      type: "follow_ups";
      suggestions: string[];
    }
  | { type: "done" }
  | { type: "error"; message: string };

export function askDataEncode(event: AskDataSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function askDataSseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function makeAskDataStream(
  writer: (send: (e: AskDataSseEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AskDataSseEvent) =>
        controller.enqueue(encoder.encode(askDataEncode(e)));
      try {
        await writer(send);
        send({ type: "done" });
      } catch (err) {
        send({
          type: "error",
          message: bankerFacingError(err),
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: askDataSseHeaders() });
}

function bankerFacingError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/aborted|cancelled/i.test(msg)) return "Request cancelled.";
  if (/timeout|timed out/i.test(msg))
    return "Upstream timed out — try a narrower question.";
  if (/ENOTFOUND|ECONNREFUSED/i.test(msg))
    return "Data Cloud is unreachable right now.";
  if (/unauthor|unauthenticated/i.test(msg))
    return "Sign in required to continue this conversation.";
  return "Something went wrong running this question.";
}
