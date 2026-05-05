import { ensureFreshToken } from "@/lib/salesforce/token";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import type { SemanticModelMetric } from "./types";

/**
 * Server-side helper for fetching a model's named metrics during RSC
 * render. Mirrors getModelProfile's no-throw behavior — returns an
 * empty list on any failure so the page keeps rendering without
 * throwing from a server component.
 *
 * The T2-5 governance drawer cross-references these metrics against
 * the assistant's narrative (client-side) to surface "Used in this
 * answer" chips.
 */
export async function getModelMetrics(
  modelId: string
): Promise<SemanticModelMetric[]> {
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) return [];

  let mcp;
  try {
    mcp = await openFirstPartyTableauNext({
      salesforceToken: sfToken.access_token,
    });
  } catch {
    return [];
  }

  try {
    const result = await mcp.callTool("list_semantic_model_metrics", {
      modelApiNameOrId: modelId,
    });
    if (result.isError) return [];
    return parseMetrics(result.content);
  } finally {
    await mcp.close();
  }
}

function parseMetrics(content: unknown): SemanticModelMetric[] {
  if (!Array.isArray(content)) return [];
  let fullText = "";
  for (const chunk of content as Array<Record<string, unknown>>) {
    if (chunk && chunk.type === "text" && typeof chunk.text === "string") {
      fullText += chunk.text;
    }
  }
  if (!fullText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(fullText);
  } catch {
    return [];
  }

  const items =
    (parsed as { metrics?: unknown }).metrics ??
    (parsed as { items?: unknown }).items ??
    (Array.isArray(parsed) ? parsed : []);
  if (!Array.isArray(items)) return [];

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
  return out.sort((a, b) => a.label.localeCompare(b.label));
}
