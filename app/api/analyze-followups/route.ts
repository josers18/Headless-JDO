import { NextResponse, type NextRequest } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import {
  generateFollowUps,
  type PriorTurn,
} from "@/lib/prompts/ask-data-followups";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analyze-followups
 *
 * body: {
 *   question: string;           // most recent banker question
 *   assistantText: string;      // most recent agent answer
 *   priorTurns?: Array<{        // earlier (user, assistant) pairs,
 *     userQuestion: string;     //  chronological; last 3 are used
 *     assistantText: string;
 *   }>;
 * }
 *
 * Returns 2-3 MiniMax-generated follow-ups contextualized against the
 * full running thread. Analyze's multi-turn workbench passes prior
 * turns so suggestions reference the conversation, not just the
 * latest answer.
 */
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: {
    question?: unknown;
    assistantText?: unknown;
    priorTurns?: unknown;
  };
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

  const priorTurns = parsePriorTurns(body.priorTurns);

  try {
    const suggestions = await generateFollowUps({
      userQuestion: question,
      assistantText: assistantText,
      priorTurns,
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ suggestions: [] });
  }
}

function parsePriorTurns(raw: unknown): PriorTurn[] {
  if (!Array.isArray(raw)) return [];
  const out: PriorTurn[] = [];
  for (const t of raw as Array<Record<string, unknown>>) {
    if (!t || typeof t !== "object") continue;
    const uq = typeof t.userQuestion === "string" ? t.userQuestion.trim() : "";
    const at =
      typeof t.assistantText === "string" ? t.assistantText.trim() : "";
    if (!uq || !at) continue;
    out.push({ userQuestion: uq, assistantText: at });
  }
  return out.slice(-3);
}
