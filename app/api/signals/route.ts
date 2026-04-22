import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import { signalsPrompt } from "@/lib/prompts/signals";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/signals — returns a compact JSON array of recent signals from
// data_360 (with light salesforce_crm enrichment). The client polls this
// endpoint every ~45s; data_360 is SQL-based and doesn't push events, so
// "live" is really "recently observed." We cap maxIterations at 6 and set
// the prompt to one tool-call round so we stay inside Heroku's 30s H12.
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
      maxIterations: 6,
      /** When HEROKU_INFERENCE_ONYX_* is set, uses Onyx deployment (ONYX_ROUTES) to save primary TPM. */
      routeHint: "signals",
    });
    log.info("signals.ok", {
      cid,
      iters: res.iterations,
      tools: res.toolCalls.length,
    });
    return NextResponse.json(
      { result: res.text, toolCalls: res.toolCalls.length },
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
