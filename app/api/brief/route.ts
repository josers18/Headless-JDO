import { NextRequest } from "next/server";
import { ensureFreshToken, getSessionId, resolveBankerDisplayName } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { morningBriefPrompt } from "@/lib/prompts/morning-brief";
import { makeCacheableSseStream, sendInferenceMeta, forwardAgentEvent } from "@/lib/sse/stream";
import { localDayInTz } from "@/lib/sse/sectionCache";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";
import { hourInTimeZone } from "@/lib/signoffPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });
  const bypass = req.nextUrl.searchParams.get("refresh") === "1";

  const now = new Date();
  // why: Heroku dynos run in UTC, so raw toLocaleTimeString() was
  // stamping e.g. "4:00 AM" into the brief context on what is actually
  // 11:00 PM ET the prior day — the model then wrote signoffs like
  // "good morning" when the banker was ending their day. Force the
  // banker's intended zone via an env var. Defaults to America/New_York
  // which fits the demo; swap via DEMO_BANKER_TZ for any other TZDB name.
  const tz = optionalEnv("DEMO_BANKER_TZ", "America/New_York");
  const localHour24 = hourInTimeZone(now, tz);
  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");
  const sessionId = await getSessionId();
  const prompt = morningBriefPrompt({
    bankerName: resolveBankerDisplayName(token),
    bankerUserId,
    localHour24,
    localTime: now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    }),
    dayOfWeek: now.toLocaleDateString([], {
      weekday: "long",
      timeZone: tz,
    }),
    date: now.toLocaleDateString([], {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    }),
  });

  log.info("brief.start", { cid, bypass });

  return makeCacheableSseStream(
    {
      route: "brief",
      bankerUserId,
      localDay: localDayInTz(now, tz),
      bypass,
    },
    async (send) => {
      const result = await runAgentWithMcp({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
        salesforceToken: token.access_token,
        userId: bankerUserId,
        sessionId,
        route: "brief",
        maxIterations: 6,
        maxTokens: 2048,
        routeHint: "morning-brief",
        onEvent: (e) => forwardAgentEvent(send, e),
      });
      sendInferenceMeta(send, result.inferenceBackend);
      log.info("brief.done", {
        cid,
        iterations: result.iterations,
        tools: result.toolCalls.length,
      });
    }
  );
}
