/**
 * Analyze SSE protocol. Isolated from Ask My Data's lib/sse/askData.ts
 * so the vocabulary can evolve independently (governance trail + chart
 * events land in T2-4/T2-5 without touching Ask My Data).
 */

export type AnalyzeSseEvent =
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
      type: "table_fallback";
      columns: string[];
      rows: Array<Record<string, unknown>>;
      caption?: string;
    }
  | { type: "persisted" }
  | { type: "done" }
  | { type: "error"; message: string };

export function analyzeEncode(event: AnalyzeSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function analyzeSseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

export function makeAnalyzeStream(
  writer: (send: (e: AnalyzeSseEvent) => void) => Promise<void>
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AnalyzeSseEvent) =>
        controller.enqueue(encoder.encode(analyzeEncode(e)));
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
  return new Response(stream, { headers: analyzeSseHeaders() });
}

function bankerFacingError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/aborted|cancelled/i.test(msg)) return "Request cancelled.";
  if (/timeout|timed out/i.test(msg))
    return "Analytics Agent timed out — try a simpler question.";
  if (/ENOTFOUND|ECONNREFUSED/i.test(msg))
    return "Tableau Next is unreachable right now.";
  if (/unauthor|unauthenticated/i.test(msg))
    return "Sign in required to continue this analysis.";
  return "Something went wrong running this analysis.";
}
