import { NextRequest } from "next/server";
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { draftQueuePrompt } from "@/lib/prompts/draft-queue";
import { makeCacheableSseStream, sendInferenceMeta, forwardAgentEvent } from "@/lib/sse/stream";
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
  const sessionId = await getSessionId();
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
        userId: bankerUserId,
        sessionId,
        route: "drafts",
        maxIterations: 7,
        maxTokens: 3072,
        routeHint: "drafts",
        onEvent: (e) => forwardAgentEvent(send, e),
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
