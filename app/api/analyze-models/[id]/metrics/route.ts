import { NextResponse } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelMetric } from "@/lib/analyze/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/analyze-models/[id]/metrics — named business metrics for
 * a single semantic model. Proxies `list_semantic_model_metrics`.
 *
 * Many SDMs have zero named metrics (the catalog depends on how the
 * model was authored). A `{ metrics: [] }` response is valid — the UI
 * empty-states it rather than filtering the model out of the picker
 * (Q-T2-arch-f = C).
 */
export async function GET(_req: Request, ctx: RouteContext) {
  const userId = await currentBankerUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) {
    return NextResponse.json(
      { error: "salesforce session expired" },
      { status: 401 }
    );
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  let mcp;
  try {
    mcp = await openFirstPartyTableauNext({
      salesforceToken: sfToken.access_token,
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "tableau next unreachable",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }

  try {
    const result = await mcp.callTool("list_semantic_model_metrics", {
      modelApiNameOrId: id,
    });
    if (result.isError) {
      return NextResponse.json(
        {
          error: "list_semantic_model_metrics failed",
          detail: result.textPreview,
        },
        { status: 502 }
      );
    }
    const { metrics, parseError } = parseMetrics(result.content);
    if (parseError) {
      return NextResponse.json(
        { error: "parse failed", detail: parseError },
        { status: 502 }
      );
    }
    return NextResponse.json({ metrics });
  } finally {
    await mcp.close();
  }
}

function parseMetrics(
  content: unknown
): { metrics: SemanticModelMetric[]; parseError: string | null } {
  if (!Array.isArray(content)) {
    return {
      metrics: [],
      parseError: "unexpected MCP content shape (expected array)",
    };
  }
  let fullText = "";
  for (const chunk of content as Array<Record<string, unknown>>) {
    if (chunk && chunk.type === "text" && typeof chunk.text === "string") {
      fullText += chunk.text;
    }
  }
  if (!fullText) {
    return { metrics: [], parseError: "no text content" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fullText);
  } catch (e) {
    return {
      metrics: [],
      parseError: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // Shape from probe: { metrics: [...] } — not items[]. Fall back to
  // items or a bare array just in case Salesforce changes the shape.
  const items =
    (parsed as { metrics?: unknown }).metrics ??
    (parsed as { items?: unknown }).items ??
    (Array.isArray(parsed) ? parsed : []);
  if (!Array.isArray(items)) {
    return {
      metrics: [],
      parseError: `expected metrics array, got ${typeof items}`,
    };
  }

  const out: SemanticModelMetric[] = [];
  for (const raw of items as Array<Record<string, unknown>>) {
    const apiName = typeof raw.apiName === "string" ? raw.apiName : null;
    if (!apiName) continue;
    const label =
      (typeof raw.label === "string" && raw.label.trim()) || apiName;
    const description =
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : undefined;
    out.push({ apiName, label, description });
  }
  return {
    metrics: out.sort((a, b) => a.label.localeCompare(b.label)),
    parseError: null,
  };
}
