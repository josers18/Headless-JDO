import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { askAnythingPrompt } from "@/lib/prompts/ask-anything";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = (body.q ?? "").trim();
  if (!q) return new Response("missing q", { status: 400 });

  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  log.info("ask.start", { cid, len: q.length });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: askAnythingPrompt(q) }],
      salesforceToken: token.access_token,
      maxIterations: 10,
      // Hard-force at least one real tool call on iteration 1. Without
      // this the model was skipping the tool loop entirely on free-form
      // asks and hallucinating Salesforce Ids from prior training.
      // See FIX_PASS.md#P0-2.
      forceFirstToolCall: true,
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
    log.info("ask.done", {
      cid,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
