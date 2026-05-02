import { NextRequest, NextResponse } from "next/server";
import {
  deleteThread,
  getThread,
  isDbConfigured,
  renameThread,
} from "@/lib/db/askThreads";
import { currentBankerUserId } from "@/lib/ask/currentUser";

const NO_DB_RESPONSE = () =>
  NextResponse.json(
    { error: "database unavailable", db: "unconfigured" },
    { status: 503 }
  );

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/ask-threads/[id] — fetch a single thread's metadata.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isDbConfigured()) return NO_DB_RESPONSE();

  const { id } = await ctx.params;
  const thread = await getThread({ id, userId });
  if (!thread)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ thread });
}

// PATCH /api/ask-threads/[id] — rename. Q-T1-2-e has pinning staying out
// of T1-2 scope, so only title is mutable here.
export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isDbConfigured()) return NO_DB_RESPONSE();

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const title =
    typeof body?.title === "string" ? body.title.trim() : "";
  if (!title)
    return NextResponse.json({ error: "title required" }, { status: 400 });
  if (title.length > 120)
    return NextResponse.json(
      { error: "title too long (max 120 chars)" },
      { status: 400 }
    );

  const before = await getThread({ id, userId });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });
  await renameThread({ id, userId, title });
  return NextResponse.json({ ok: true });
}

// DELETE /api/ask-threads/[id] — hard delete, cascades to messages.
export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const userId = await currentBankerUserId();
  if (!userId)
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isDbConfigured()) return NO_DB_RESPONSE();

  const { id } = await ctx.params;
  const ok = await deleteThread({ id, userId });
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
