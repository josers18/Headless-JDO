import type { ReasoningStep, McpServerName } from "@/types/horizon";

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
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: sseHeaders() });
}
