import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { runAgentWithMcp } from "@/lib/llm/provider";
import { SYSTEM_PROMPT } from "@/lib/prompts/system";
import type { DraftAction } from "@/types/horizon";
import { log, correlationId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExecuteBody {
  action: DraftAction;
}

// POST /api/actions — execute an already-drafted action. Horizon drafts via
// the LLM, but execution is a separate confirm-then-commit step (CLAUDE.md §7
// rule 7). We pass the draft back to the MCP-enabled agent with an explicit
// "EXECUTE" instruction so the mutating tool call happens under the banker's
// OAuth token against salesforce_crm.
export async function POST(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as ExecuteBody | null;
  if (!body?.action)
    return NextResponse.json(
      { error: "missing action in body" },
      { status: 400 }
    );

  const { action } = body;
  log.info("actions.execute.start", {
    cid,
    kind: action.kind,
    target: action.target_object,
  });

  const instruction = `EXECUTE this approved draft via salesforce_crm. Do NOT ask for confirmation — the banker has already approved it. After the write succeeds, return ONLY JSON: {"status":"ok","id":"<sf record id>"}.

Approved draft:
${JSON.stringify(action, null, 2)}`;

  try {
    const res = await runAgentWithMcp({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: instruction }],
      salesforceToken: token.access_token,
      maxIterations: 4,
    });

    const text = res.text.trim();
    log.info("actions.execute.ok", {
      cid,
      iters: res.iterations,
      tools: res.toolCalls.length,
    });
    return NextResponse.json({
      result: text,
      toolCalls: res.toolCalls.map((c) => ({
        server: c.server,
        tool: c.tool,
        isError: c.isError,
      })),
    });
  } catch (e) {
    log.error("actions.execute.failed", { cid, err: String(e) });
    return NextResponse.json(
      { error: "execute failed", detail: String(e) },
      { status: 500 }
    );
  }
}
