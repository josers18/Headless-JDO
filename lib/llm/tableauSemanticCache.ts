/**
 * lib/llm/tableauSemanticCache.ts — read side of the Tableau Next SDM cache.
 *
 * Companion to dcMetadataCache.ts. Populated every 12h by
 * scripts/refresh-tableau-sdms.ts. Exposes:
 *   - loadCachedSdms()            : read the Redis envelope, null on miss
 *   - toSystemPromptSection()     : render a compact SDM catalog block
 *                                   the model reads at turn start so it can
 *                                   pick an apiName + craft a targeted
 *                                   analyze_data utterance without having
 *                                   to call list_semantic_models first
 *
 * Graceful degradation: null when Redis missing or cache empty — calling
 * code falls back to the live discovery path.
 */

import { getRedis } from "@/lib/redis";

const REDIS_KEY_PREFIX = "tableau:sdms:v1:";

export interface CachedSdmDataObject {
  apiName: string;
  label?: string;
  dimensions: Array<{ apiName: string; label?: string }>;
  measurements: Array<{ apiName: string; label?: string }>;
}

export interface CachedSdm {
  apiName: string;
  label?: string;
  description?: string;
  dataspace?: string;
  dataObjects: CachedSdmDataObject[];
  metrics: Array<{ apiName: string; label?: string; description?: string }>;
}

export interface CachedSdmEnvelope {
  generatedAt: string;
  dataspace: string;
  totalSdms: number;
  survivingSdms: number;
  excludedSdms: number;
  sdms: CachedSdm[];
}

export async function loadCachedSdms(
  dataspace: string = "default"
): Promise<CachedSdmEnvelope | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${dataspace}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSdmEnvelope;
    if (!parsed || !Array.isArray(parsed.sdms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Render the SDM catalog as a markdown block injectable into the system
 * prompt. Shows apiName + label + description + each dataObject's
 * dimensions/measurements with up to `attrsPerObject` attrs each. Model
 * reads this and can call analyze_data directly — no list_semantic_models
 * round-trip needed.
 */
export function toSystemPromptSection(
  envelope: CachedSdmEnvelope | null,
  opts: { attrsPerObject?: number } = {}
): string {
  if (!envelope || envelope.sdms.length === 0) return "";
  const attrsPerObject = opts.attrsPerObject ?? 8;

  const lines: string[] = [];
  lines.push(
    `TABLEAU NEXT SEMANTIC MODELS (pre-loaded from ${envelope.generatedAt}; no list_semantic_models call needed this turn)`
  );
  lines.push(
    `Dataspace: ${envelope.dataspace} · ${envelope.survivingSdms} banker-relevant SDMs (${envelope.excludedSdms} internal/Agentforce SDMs filtered out).`
  );
  lines.push("");
  lines.push(`RULES (STRICT):`);
  lines.push(
    `- Pass the apiName VERBATIM as "targetEntityIdOrApiName" on analyze_data. Set "targetEntityType" to "sdm".`
  );
  lines.push(
    `- Category labels (Sales, Service, Marketing, Commerce, Other) are NOT valid apiNames — never pass one in targetEntityIdOrApiName. Every model in this org has empty categories anyway, so that filter returns zero.`
  );
  lines.push(
    `- Utterances must be ≤ 15 words, single-facet. Reference a dimension or measurement from the listed objects to ground the question (e.g. "total Transaction_Amount by Account_Name last 30 days"). Long multi-clause questions hit the 20s timeout.`
  );
  lines.push("");
  lines.push(
    `Format: apiName — "label" [dataspace] — description`
  );
  lines.push(
    `  dataObject.apiName — dims: […] · measures: […]`
  );
  for (const sdm of envelope.sdms) {
    const ds = sdm.dataspace ? ` [${sdm.dataspace}]` : "";
    const desc = sdm.description
      ? ` — ${sdm.description.slice(0, 160)}`
      : "";
    lines.push(`- ${sdm.apiName} — "${sdm.label ?? sdm.apiName}"${ds}${desc}`);
    for (const obj of sdm.dataObjects) {
      const dims = obj.dimensions
        .slice(0, attrsPerObject)
        .map((d) => d.apiName)
        .join(", ");
      const dimsMore =
        obj.dimensions.length > attrsPerObject
          ? `, +${obj.dimensions.length - attrsPerObject} more`
          : "";
      const msrs = obj.measurements
        .slice(0, attrsPerObject)
        .map((m) => m.apiName)
        .join(", ");
      const msrsMore =
        obj.measurements.length > attrsPerObject
          ? `, +${obj.measurements.length - attrsPerObject} more`
          : "";
      lines.push(
        `    · ${obj.apiName} — dims: [${dims}${dimsMore}] · measures: [${msrs}${msrsMore}]`
      );
    }
    if (sdm.metrics.length > 0) {
      const mts = sdm.metrics
        .slice(0, 6)
        .map((m) => `${m.apiName}${m.label ? ` (${m.label})` : ""}`)
        .join(", ");
      lines.push(`    · metrics: ${mts}`);
    }
  }
  return lines.join("\n");
}
