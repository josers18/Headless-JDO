import { NextRequest } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { clientDetailPrompt } from "@/lib/prompts/client-detail";
import { makeSseStream } from "@/lib/anthropic/stream";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/client/[id] — streams the 360° client detail view as SSE.
// Fan-out across salesforce_crm + data_360 + tableau_next is heavy; we
// reuse the SSE pattern from /api/priority so Heroku's 30s H12 timeout
// is not an issue and the UI shows MCP activity live.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const clientId = decodeURIComponent(params.id);
  const clientName = req.nextUrl.searchParams.get("name") ?? undefined;

  log.info("client.start", { cid, clientId });

  return makeSseStream(async (send) => {
    const result = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: clientDetailPrompt({
            clientId,
            clientName,
            bankerUserId:
              token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown"),
          }),
        },
      ],
      salesforceToken: token.access_token,
      maxIterations: 14,
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
    log.info("client.done", {
      cid,
      clientId,
      iterations: result.iterations,
      tools: result.toolCalls.length,
    });
  });
}
