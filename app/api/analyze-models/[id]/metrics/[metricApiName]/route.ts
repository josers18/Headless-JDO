import { NextResponse } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelMetricDefinition } from "@/lib/analyze/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ id: string; metricApiName: string }>;
};

/**
 * GET /api/analyze-models/[id]/metrics/[metricApiName]
 *
 * Full metric definition. Powers the T2-5 governance drawer. Flattens
 * the raw Tableau response into banker-readable fields + preserves
 * the raw blob so the "Show raw" toggle can surface everything.
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

  const { id, metricApiName } = await ctx.params;
  if (!id || !metricApiName) {
    return NextResponse.json(
      { error: "id and metricApiName required" },
      { status: 400 }
    );
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
    const result = await mcp.callTool("get_semantic_model_metric", {
      modelApiNameOrId: id,
      metricNameOrId: metricApiName,
    });
    if (result.isError) {
      return NextResponse.json(
        {
          error: "get_semantic_model_metric failed",
          detail: result.textPreview,
        },
        { status: 502 }
      );
    }
    const { definition, parseError } = parseDefinition(result.content);
    if (parseError) {
      return NextResponse.json(
        { error: "parse failed", detail: parseError },
        { status: 502 }
      );
    }
    if (!definition) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ definition });
  } finally {
    await mcp.close();
  }
}

function parseDefinition(
  content: unknown
): {
  definition: SemanticModelMetricDefinition | null;
  parseError: string | null;
} {
  if (!Array.isArray(content)) {
    return {
      definition: null,
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
    return { definition: null, parseError: "no text content" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fullText) as Record<string, unknown>;
  } catch (e) {
    return {
      definition: null,
      parseError: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const apiName = typeof raw.apiName === "string" ? raw.apiName : null;
  if (!apiName) {
    return { definition: null, parseError: "missing apiName" };
  }

  // Dig into `measurementReference.tableFieldReference` for source info.
  const measurement = raw.measurementReference as
    | Record<string, unknown>
    | undefined;
  const tableFieldRef =
    (measurement?.tableFieldReference as
      | Record<string, unknown>
      | undefined) ?? undefined;
  const sourceTable =
    typeof tableFieldRef?.tableApiName === "string"
      ? tableFieldRef.tableApiName
      : undefined;
  const sourceField =
    typeof tableFieldRef?.fieldApiName === "string"
      ? tableFieldRef.fieldApiName
      : undefined;

  const definition: SemanticModelMetricDefinition = {
    apiName,
    label:
      (typeof raw.label === "string" && raw.label.trim()) || apiName,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : undefined,
    aggregationType:
      typeof raw.aggregationType === "string"
        ? raw.aggregationType
        : undefined,
    isCumulative:
      typeof raw.isCumulative === "boolean" ? raw.isCumulative : undefined,
    sourceTable,
    sourceField,
    timeGrains: Array.isArray(raw.timeGrains)
      ? (raw.timeGrains as unknown[]).filter(
          (g): g is string => typeof g === "string"
        )
      : undefined,
    lastModifiedDate:
      typeof raw.lastModifiedDate === "string"
        ? raw.lastModifiedDate
        : undefined,
    raw,
  };

  return { definition, parseError: null };
}
