import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { pulseStripPrompt } from "@/lib/prompts/pulse-strip";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pulse-strip — SSE; narrative accumulates to JSON for PulseStrip.tsx */
export async function GET(_req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");
  const bankerTz = optionalEnv("DEMO_BANKER_TZ", "America/New_York");

  log.info("pulse-strip.start", { cid, banker: bankerUserId });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: pulseStripPrompt({ bankerUserId, bankerTz }),
        },
      ],
      salesforceToken: token.access_token,
      maxIterations: 10,
      forceFirstToolCall: true,
      routeHint: "pulse-strip",
      onEvent: (e) => {
        if (e.type === "text_delta" && e.text) {
          send({ type: "text_delta", text: e.text });
        } else if (e.type === "tool_use" && e.server && e.tool) {
          send({
            type: "tool_use",
            server: e.server,
            tool: e.tool,
            input: e.input,
          });
        } else if (e.type === "tool_result" && e.server && e.tool) {
          send({
            type: "tool_result",
            server: e.server,
            tool: e.tool,
            is_error: e.is_error,
            preview: e.preview ?? "",
          });
        }
      },
    });
    log.info("pulse-strip.done", {
      cid,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
