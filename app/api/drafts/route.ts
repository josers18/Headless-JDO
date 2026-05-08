import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { draftQueuePrompt } from "@/lib/prompts/draft-queue";
import { makeCacheableSseStream, sendInferenceMeta } from "@/lib/sse/stream";
import { localDayInTz } from "@/lib/sse/sectionCache";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/drafts — streams a short list of pre-drafted actions the banker
// can approve with one click. The agent is explicitly instructed to
// DRAFT-only; actual execution is a separate POST /api/actions call.
// SSE again, same reasoning as /api/priority (30s H12 + live MCP activity).
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
  const tz = optionalEnv("DEMO_BANKER_TZ", "America/New_York");

  log.info("drafts.start", { cid, bypass });

  return makeCacheableSseStream(
    {
      route: "drafts",
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
            content: draftQueuePrompt({
              bankerUserId,
              count: 3,
            }),
          },
        ],
        salesforceToken: token.access_token,
        maxIterations: 7,
        maxTokens: 3072,
        routeHint: "drafts",
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
      log.info("drafts.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    }
  );
}
