import { NextRequest } from "next/server";
import { log, correlationId } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const cid = correlationId();
  const body = (await req.json().catch(() => ({}))) as {
    nodeId?: string;
    title?: string;
    approxLeftPct?: number;
    intent?: string;
  };
  log.info("arc.drag_intent", {
    cid,
    nodeId: typeof body.nodeId === "string" ? body.nodeId : undefined,
    title: typeof body.title === "string" ? body.title.slice(0, 120) : undefined,
    approxLeftPct:
      typeof body.approxLeftPct === "number" ? body.approxLeftPct : undefined,
    intent: typeof body.intent === "string" ? body.intent : "reschedule",
  });
  return Response.json({ ok: true });
}
