import { NextRequest, NextResponse } from "next/server";
import {
  createThread,
  isDbConfigured,
  listThreads,
} from "@/lib/db/askThreads";
import { currentBankerUserId } from "@/lib/ask/currentUser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/ask-threads — list threads owned by the signed-in banker,
// most recent first (pinned on top). Used by the sidebar in /ask.
export async function GET(_req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!isDbConfigured()) {
    return NextResponse.json({ threads: [], db: "unconfigured" });
  }

  const threads = await listThreads({ userId });
  return NextResponse.json({ threads });
}

// POST /api/ask-threads — create an empty thread. T1-2 lets the sidebar's
// "+ New thread" create one; T1-3 populates the first message after the
// initial agent turn returns.
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  if (!isDbConfigured()) {
    return NextResponse.json(
      {
        error: "database unavailable",
        db: "unconfigured",
      },
      { status: 503 }
    );
  }

  let body: { title?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body → default title */
  }
  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = rawTitle || "New conversation";
  if (title.length > 120) {
    return NextResponse.json(
      { error: "title too long (max 120 chars)" },
      { status: 400 }
    );
  }

  const thread = await createThread({ userId, title });
  return NextResponse.json({ thread }, { status: 201 });
}
