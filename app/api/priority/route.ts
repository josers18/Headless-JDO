import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { priorityQueuePrompt } from "@/lib/prompts/priority-queue";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/priority — returns the top N clients ranked by composite score.
// Runs an MCP-capable agent loop via the current provider (Heroku Inference
// by default). Non-streaming; the UI shows a skeleton while we wait.
export async function GET(_req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  try {
    const res = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: priorityQueuePrompt({
            bankerUserId:
              token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown"),
            topN: 5,
          }),
        },
      ],
      salesforceToken: token.access_token,
      // Priority-queue prompt returns JSON only; small cap keeps latency tight.
      maxIterations: 6,
    });

    const text = res.text.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(text));
    } catch {
      parsed = { raw: text, note: "model did not return parseable JSON" };
    }
    log.info("priority.ok", {
      cid,
      iters: res.iterations,
      tools: res.toolCalls.length,
    });
    return NextResponse.json(parsed);
  } catch (e) {
    log.error("priority.failed", { cid, err: String(e) });
    return NextResponse.json(
      { error: "priority failed", detail: String(e) },
      { status: 500 }
    );
  }
}

// Strip any fenced code blocks (```json ... ```) before JSON.parse. Claude
// 4.5 Sonnet usually returns bare JSON when asked, but we guard anyway.
function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fence?.[1] ?? text).trim();
}
