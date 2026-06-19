import { NextRequest } from "next/server";
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { portfolioPulsePrompt } from "@/lib/prompts/portfolio-pulse";
import { makeCacheableSseStream, sendInferenceMeta, forwardAgentEvent } from "@/lib/sse/stream";
import { localDayInTz } from "@/lib/sse/sectionCache";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pulse — streams the portfolio pulse as SSE. Uses the same
// streaming pattern as /api/priority so tableau_next's Analytics Q&A
// round-trips don't blow past the Heroku 30s H12 timeout.
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

  log.info("pulse.start", { cid, bypass });

  return makeCacheableSseStream(
    {
      route: "pulse",
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
            content: portfolioPulsePrompt({ bankerUserId }),
          },
        ],
        salesforceToken: token.access_token,
        userId: bankerUserId,
        sessionId,
        route: "pulse",
        maxIterations: 6,
        maxTokens: 2048,
        routeHint: "portfolio-pulse",
        onEvent: (e) => forwardAgentEvent(send, e),
      });
      sendInferenceMeta(send, result.inferenceBackend);
      log.info("pulse.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    }
  );
}
