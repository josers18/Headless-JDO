import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { signalsPrompt } from "@/lib/prompts/signals";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";
import { modelIdFor } from "@/lib/llm/inferenceClients";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/signals — compact JSON of recent CRM-backed signals. The client
// polls every ~45s ("live" = recently observed). CRM-only plan + iteration
// cap keeps the agent under Heroku's ~30s HTTP window to avoid 503s.
export async function GET(_req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  log.info("signals.start", { cid });

  try {
    const res = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: signalsPrompt({
            bankerUserId:
              token.user_id ?? optionalEnv("DEMO_BANKER_USER_ID", "unknown"),
            windowHours: 24,
          }),
        },
      ],
      salesforceToken: token.access_token,
      /** CRM-only prompt + tight caps — stay under Heroku's ~30s router limit. */
      maxIterations: 5,
      maxTokens: 2048,
      /** Primary is always Claude; Kimi (Onyx) is only used if primary fails. */
      routeHint: "signals",
    });
    log.info("signals.ok", {
      cid,
      iters: res.iterations,
      tools: res.toolCalls.length,
    });
    return NextResponse.json(
      {
        result: res.text,
        toolCalls: res.toolCalls.length,
        inference_backend: res.inferenceBackend,
        model: modelIdFor(res.inferenceBackend),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    log.error("signals.failed", { cid, err: String(e) });
    return NextResponse.json(
      { error: "signals failed", detail: String(e) },
      { status: 500 }
    );
  }
}
