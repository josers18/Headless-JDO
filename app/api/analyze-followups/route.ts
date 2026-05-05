import { NextResponse, type NextRequest } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import { generateFollowUps } from "@/lib/prompts/ask-data-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analyze-followups
 *
 * body: { question: string; assistantText: string }
 *
 * Returns 2-3 MiniMax-generated follow-up questions contextual to the
 * banker's just-completed analyze turn. Reuses the Ask My Data
 * generator since the prompt + output shape is domain-agnostic (both
 * use the same "next-step pills for an exploratory banker" framing).
 *
 * Called client-side by AnalyzeFollowUps after a turn's stream ends —
 * keeps the SSE path lean and lets follow-up latency not block the
 * narrative render.
 */
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: { question?: unknown; assistantText?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  const assistantText =
    typeof body.assistantText === "string" ? body.assistantText.trim() : "";
  if (!question || !assistantText) {
    return NextResponse.json(
      { error: "question and assistantText required" },
      { status: 400 }
    );
  }

  try {
    const suggestions = await generateFollowUps({
      userQuestion: question,
      assistantText: assistantText,
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}
