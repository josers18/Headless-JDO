import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { morningBriefPrompt } from "@/lib/prompts/morning-brief";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const now = new Date();
  const prompt = morningBriefPrompt({
    bankerName: optionalEnv("DEMO_BANKER_NAME", "there"),
    bankerUserId:
      token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown"),
    localTime: now.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    }),
    dayOfWeek: now.toLocaleDateString([], { weekday: "long" }),
    date: now.toLocaleDateString([], {
      month: "long",
      day: "numeric",
      year: "numeric",
    }),
  });

  log.info("brief.start", { cid });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      salesforceToken: token.access_token,
      maxIterations: 16,
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
    log.info("brief.done", {
      cid,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
