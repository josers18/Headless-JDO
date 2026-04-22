import { NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { askAnythingPrompt } from "@/lib/prompts/ask-anything";
import { makeSseStream, sendInferenceMeta } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";
import { validateAskThreadMessages } from "@/lib/ask/thread";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AskBody = {
  messages?: unknown;
  q?: string;
  context?: string;
  /** Client sets when the submission came from a GhostPrompt (Onyx routing). */
  source?: unknown;
};

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const body = (await req.json().catch(() => ({}))) as AskBody;

  let seedMessages: ChatCompletionMessageParam[];

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const v = validateAskThreadMessages(body.messages);
    if (!v.ok) {
      return new Response(v.error, { status: 400 });
    }
    seedMessages = v.messages;
  } else {
    const q = (typeof body.q === "string" ? body.q : "").trim();
    if (!q) return new Response("missing messages or q", { status: 400 });
    seedMessages = [{ role: "user", content: q }];
  }

  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");

  const last = seedMessages[seedMessages.length - 1];
  const rawUtterance =
    last && last.role === "user" && typeof last.content === "string"
      ? last.content
      : "";

  const priorSeed = seedMessages.slice(0, -1);
  const hasPriorToolContext = priorSeed.some(
    (m: ChatCompletionMessageParam) => m.role === "tool"
  );

  const scrollContext =
    typeof body.context === "string" ? body.context.trim() : "";

  const messagesForApi: ChatCompletionMessageParam[] = [
    ...priorSeed,
    {
      role: "user",
      content: askAnythingPrompt(rawUtterance.trim(), {
        bankerUserId,
        hasPriorToolContext,
        scrollContext: scrollContext || undefined,
      }),
    },
  ];

  const forceFirstToolCall = !hasPriorToolContext;

  const fromGhostClick = body.source === "ghost";

  log.info("ask.start", {
    cid,
    turns: messagesForApi.length,
    banker: bankerUserId,
    forceFirstToolCall,
    fromGhost: fromGhostClick,
  });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: messagesForApi,
      salesforceToken: token.access_token,
      maxIterations: 12,
      forceFirstToolCall,
      routeHint: fromGhostClick ? "ghost-ask" : undefined,
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
    send({ type: "thread_snapshot", messages: result.transcript });
    log.info("ask.done", {
      cid,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
