import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelProfile } from "./types";

/**
 * Server-side helper for fetching a model profile during RSC render.
 * Mirrors the logic in app/api/analyze-models/[id]/route.ts but callable
 * without going through an HTTP hop — the page component uses this for
 * fast first paint (Q-T2-2-a = C).
 *
 * Returns null on any failure (auth, network, parse) — the page shows
 * a graceful error state rather than throwing, so the sidebar stays
 * interactive.
 */
export async function getModelProfile(
  id: string
): Promise<SemanticModelProfile | null> {
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) return null;

  let mcp;
  try {
    mcp = await openFirstPartyTableauNext({
      salesforceToken: sfToken.access_token,
    });
  } catch {
    return null;
  }

  try {
    const result = await mcp.callTool("get_semantic_model", {
      modelApiNameOrId: id,
    });
    if (result.isError) return null;
    return parseProfile(result.content);
  } finally {
    await mcp.close();
  }
}

function parseProfile(content: unknown): SemanticModelProfile | null {
  if (!Array.isArray(content)) return null;
  let fullText = "";
  for (const chunk of content as Array<Record<string, unknown>>) {
    if (chunk && chunk.type === "text" && typeof chunk.text === "string") {
      fullText += chunk.text;
    }
  }
  if (!fullText) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fullText) as Record<string, unknown>;
  } catch {
    return null;
  }

  const id = typeof raw.id === "string" ? raw.id : null;
  const apiName = typeof raw.apiName === "string" ? raw.apiName : null;
  if (!id || !apiName) return null;

  return {
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
}
