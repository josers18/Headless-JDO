import { NextRequest } from "next/server";
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { arcPrompt } from "@/lib/prompts/arc";
import { makeCacheableSseStream, sendInferenceMeta } from "@/lib/sse/stream";
import { localDayInTz } from "@/lib/sse/sectionCache";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });
  const bypass = req.nextUrl.searchParams.get("refresh") === "1";

  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");
  const sessionId = await getSessionId();
  const bankerTz = optionalEnv("DEMO_BANKER_TZ", "America/New_York");

  log.info("arc.start", { cid, banker: bankerUserId, bypass });

  return makeCacheableSseStream(
    {
      route: "arc",
      bankerUserId,
      localDay: localDayInTz(new Date(), bankerTz),
      bypass,
    },
    async (send) => {
      const result = await runAgentWithMcp({
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: arcPrompt({ bankerUserId, bankerTz }),
          },
        ],
        salesforceToken: token.access_token,
        userId: bankerUserId,
        sessionId,
        route: "arc",
        maxIterations: 6,
        maxTokens: 2048,
        forceFirstToolCall: true,
        routeHint: "arc",
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
      log.info("arc.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    }
  );
}
