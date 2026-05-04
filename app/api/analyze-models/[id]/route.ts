import { NextResponse } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelProfile } from "@/lib/analyze/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/analyze-models/[id] — detailed profile of a single semantic
 * model. Thin wrapper around `get_semantic_model`. Flattens the
 * ~56KB raw response down to SemanticModelProfile (10 fields).
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
    const result = await mcp.callTool("get_semantic_model", {
      modelApiNameOrId: id,
    });
    if (result.isError) {
      return NextResponse.json(
        { error: "get_semantic_model failed", detail: result.textPreview },
        { status: 502 }
      );
    }
    const { profile, parseError } = parseProfile(result.content);
    if (parseError) {
      return NextResponse.json(
        { error: "parse failed", detail: parseError },
        { status: 502 }
      );
    }
    if (!profile) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ profile });
  } finally {
    await mcp.close();
  }
}

function parseProfile(
  content: unknown
): { profile: SemanticModelProfile | null; parseError: string | null } {
  if (!Array.isArray(content)) {
    return {
      profile: null,
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
    return { profile: null, parseError: "no text content" };
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fullText) as Record<string, unknown>;
  } catch (e) {
    return {
      profile: null,
      parseError: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  const apiName = typeof raw.apiName === "string" ? raw.apiName : null;
  if (!id || !apiName) {
    return { profile: null, parseError: "response missing id or apiName" };
  }

  const profile: SemanticModelProfile = {
    id,
    apiName,
    label:
      (typeof raw.label === "string" && raw.label.trim()) || apiName,
    description:
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : undefined,
    businessPreferences:
      typeof raw.businessPreferences === "string" &&
      raw.businessPreferences.trim()
        ? raw.businessPreferences.trim()
        : undefined,
    dataspace:
      typeof raw.dataspace === "string" ? raw.dataspace : undefined,
    lastModifiedDate:
      typeof raw.lastModifiedDate === "string"
        ? raw.lastModifiedDate
        : undefined,
    categories: Array.isArray(raw.categories)
      ? (raw.categories as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : [],
  };
  return { profile, parseError: null };
}
