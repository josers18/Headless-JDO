import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { askAnythingPrompt } from "@/lib/prompts/ask-anything";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const body = (await req.json().catch(() => ({}))) as { q?: string };
  const q = (body.q ?? "").trim();
  if (!q) return new Response("missing q", { status: 400 });

  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  // why: threading the banker's user_id directly into the prompt saves one
  // tool call per Ask Bar turn (the model previously had to call
  // salesforce_crm.getUserInfo first) and prevents a specific failure mode
  // where the model would emit a SOQL with `OwnerId = '<UNKNOWN>'` because
  // it didn't correctly chain the getUserInfo result into the next query.
  // Falls back to DEMO_BANKER_USER_ID env var (or "unknown") only if the
  // token genuinely lacks a user_id; the prompt handles the unknown case.
  const bankerUserId =
    token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown");

  log.info("ask.start", { cid, len: q.length, banker: bankerUserId });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: askAnythingPrompt(q, { bankerUserId }) },
      ],
      salesforceToken: token.access_token,
      // why: the "top at-risk check-in" test made 13 successful tool
      // calls and then hit the cap before the model could summarize,
      // yielding an empty narrative on the UI. 12 gives Ask Bar
      // questions a small buffer without inviting unbounded loops; the
      // forced-finalize pass in lib/llm/heroku.ts catches the residual
      // case where even 12 isn't enough.
      maxIterations: 12,
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
