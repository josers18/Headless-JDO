import { NextRequest } from "next/server";
import { ensureFreshToken, resolveBankerDisplayName } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { prepPrompt } from "@/lib/prompts/prep";
import { makeSseStream, sendInferenceMeta } from "@/lib/sse/stream";
import { log, correlationId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * C-2 — /api/prep. Given a clientId (and optionally a clientName + reason),
 * stream a focused pre-call briefing. The banker fires Prep me from any
 * surface and this single endpoint answers for all of them.
 */
export async function POST(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  let body: { clientId?: string; clientName?: string; reason?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
  if (!clientId) {
    return new Response("clientId required", { status: 400 });
  }

  const prompt = prepPrompt({
    clientId,
    clientName:
      typeof body.clientName === "string" && body.clientName.trim()
        ? body.clientName.trim()
        : undefined,
    bankerName: resolveBankerDisplayName(token),
    reason:
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : undefined,
  });

  log.info("prep.start", { cid, clientId });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
      salesforceToken: token.access_token,
      maxIterations: 14,
      routeHint: "prep",
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
    log.info("prep.done", {
      cid,
      clientId,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
