import { NextRequest, NextResponse } from "next/server";
import {
  getThread,
  isDbConfigured,
  listMessages,
} from "@/lib/db/askThreads";
import { currentBankerUserId } from "@/lib/ask/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/ask-threads/[id]/messages — full message history for a thread.
// Verifies thread ownership via getThread(id, userId) before returning
// messages so the endpoint can't leak another banker's conversation via
// a guessed UUID.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "database unavailable", db: "unconfigured" },
      { status: 503 }
    );
  }

  const { id } = await ctx.params;
  const thread = await getThread({ id, userId });
  if (!thread)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const messages = await listMessages({ threadId: id });
  return NextResponse.json({ thread, messages });
}
