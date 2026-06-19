import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { summarizeSessionUsage } from "@/lib/db/tokenUsage";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const token = await ensureFreshToken();
  if (!token) return new Response("unauthenticated", { status: 401 });

  const sessionId = await getSessionId();
  try {
    const summary = await summarizeSessionUsage(sessionId);
    return Response.json(summary);
  } catch (e) {
    log.warn("usage.read_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    // Degrade to an empty summary rather than a 500 — the panel just
    // shows nothing instead of breaking the page.
    return Response.json({
      models: [],
      totals: { inputTokens: 0, outputTokens: 0, exact: true },
    });
  }
}
