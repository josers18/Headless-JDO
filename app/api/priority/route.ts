import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { priorityQueuePrompt } from "@/lib/prompts/priority-queue";
import { makeSseStream, sendInferenceMeta } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/priority — streams the top-N priority clients as SSE.
//
// why streaming: the MCP tool loop against three Salesforce MCPs typically
// runs 40–60s end-to-end, which blows past Heroku's 30s H12 timeout for
// non-streaming HTTP. By emitting text_delta / tool_use / tool_result frames
// over SSE the connection stays warm indefinitely, the UI gets live
// progress, and the router never times us out. The client parses the final
// accumulated text as JSON when the stream closes.
export async function GET(_req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  log.info("priority.start", { cid });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: priorityQueuePrompt({
            bankerUserId:
              token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown"),
            topN: 5,
          }),
        },
      ],
      salesforceToken: token.access_token,
      maxIterations: 14,
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
    sendInferenceMeta(send, result.inferenceBackend);
    log.info("priority.done", {
      cid,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
