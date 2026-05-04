import { NextResponse } from "next/server";
import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelSummary } from "@/lib/analyze/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analyze-models — list semantic models the banker can query.
 *
 * Proxies `list_semantic_models` on the Tableau Next MCP. Flattens the
 * response into SemanticModelSummary so the UI doesn't care about
 * Tableau's 18-field shape.
 */
export async function GET() {
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
    const result = await mcp.callTool("list_semantic_models", {});
    if (result.isError) {
      return NextResponse.json(
        {
          error: "list_semantic_models failed",
          detail: result.textPreview,
        },
        { status: 502 }
      );
    }
    // content is the raw MCP response — pass it through so we're not
    // bound by the modelText 8k truncation (which is for LLM context,
    // not API parsing). list_semantic_models on this org returns ~18k
    // chars across 16 models.
    const { models, parseError } = parseModels(result.content);
    if (parseError) {
      return NextResponse.json(
        { error: "parse failed", detail: parseError },
        { status: 502 }
      );
    }
    return NextResponse.json({ models });
  } finally {
    await mcp.close();
  }
}

/**
 * The MCP returns `content` as an array of chunks; text chunks concatenate
 * into one JSON blob. We parse that blob here, surfacing parse failures
 * (rather than silently returning an empty list) so UI can distinguish
 * "no models" from "couldn't parse response".
 */
function parseModels(
  content: unknown
): { models: SemanticModelSummary[]; parseError: string | null } {
  if (!Array.isArray(content)) {
    return {
      models: [],
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
    return { models: [], parseError: "MCP response had no text content" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fullText);
  } catch (e) {
    return {
      models: [],
      parseError: `JSON.parse failed: ${e instanceof Error ? e.message : String(e)}. First 200 chars: ${fullText.slice(0, 200)}`,
    };
  }

  const items =
    (parsed as { items?: unknown }).items ??
    (parsed as { semanticModels?: unknown }).semanticModels ??
    (parsed as { models?: unknown }).models ??
    (Array.isArray(parsed) ? parsed : []);
  if (!Array.isArray(items)) {
    return {
      models: [],
      parseError: `expected items array, got ${typeof items}`,
    };
  }

  const out: SemanticModelSummary[] = [];
  for (const raw of items as Array<Record<string, unknown>>) {
    const id = typeof raw.id === "string" ? raw.id : null;
    const apiName = typeof raw.apiName === "string" ? raw.apiName : null;
    if (!id || !apiName) continue;
    const label =
      (typeof raw.label === "string" && raw.label.trim()) || apiName;
    const description =
      typeof raw.description === "string" && raw.description.trim()
        ? raw.description.trim()
        : undefined;
    const dataspace =
      typeof raw.dataspace === "string" ? raw.dataspace : undefined;
    const lastModifiedDate =
      typeof raw.lastModifiedDate === "string"
        ? raw.lastModifiedDate
        : undefined;
    const categories = Array.isArray(raw.categories)
      ? (raw.categories as unknown[]).filter(
          (c): c is string => typeof c === "string"
        )
      : [];
    out.push({
      id,
      apiName,
      label,
      description,
      dataspace,
      lastModifiedDate,
      categories,
    });
  }
  // Sort alphabetically by label for a predictable picker.
  return {
    models: out.sort((a, b) => a.label.localeCompare(b.label)),
    parseError: null,
  };
}
