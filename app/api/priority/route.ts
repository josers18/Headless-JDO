import { NextRequest } from "next/server";
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { priorityQueuePrompt } from "@/lib/prompts/priority-queue";
import { makeCacheableSseStream, sendInferenceMeta } from "@/lib/sse/stream";
import { localDayInTz } from "@/lib/sse/sectionCache";
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
//
// Daily section cache: first hit per banker per local-day pays the agent
// loop and persists the captured event sequence; subsequent loads replay
// from Redis. Banker-initiated refresh via ?refresh=1 bypasses the read.
export async function GET(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });
  const bypass = req.nextUrl.searchParams.get("refresh") === "1";

  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");
  const sessionId = await getSessionId();
  const tz = optionalEnv("DEMO_BANKER_TZ", "America/New_York");

  log.info("priority.start", { cid, bypass });

  return makeCacheableSseStream(
    {
      route: "priority",
      bankerUserId,
      localDay: localDayInTz(new Date(), tz),
      bypass,
    },
    async (send) => {
      const result = await runAgentWithMcp({
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: priorityQueuePrompt({
              bankerUserId,
              topN: 5,
            }),
          },
        ],
        salesforceToken: token.access_token,
        userId: bankerUserId,
        sessionId,
        route: "priority",
        maxIterations: 7,
        maxTokens: 2048,
        routeHint: "priority",
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
          } else if (e.type === "usage_meta" && e.usage) {
            send({ type: "usage_meta", usage: e.usage });
          }
        },
      });
      sendInferenceMeta(send, result.inferenceBackend);
      log.info("priority.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    }
  );
}
