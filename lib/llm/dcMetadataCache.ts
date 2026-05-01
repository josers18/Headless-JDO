/**
 * lib/llm/dcMetadataCache.ts — read side of the Data Cloud metadata cache.
 *
 * The cache is populated by scripts/refresh-dc-metadata.ts (scheduled every
 * 12h). This module exposes:
 *
 *   - loadCachedDcMetadata()   : read the Redis envelope, return null on miss
 *   - toDcSnapshot(envelope)   : hydrate the envelope into a DcSnapshot that
 *                                 the existing SQL preflight in lib/llm/heroku.ts
 *                                 already knows how to check
 *   - toSystemPromptSection()  : render the surviving catalog as a compact
 *                                 markdown block the model can read at turn
 *                                 start — no tool call required
 *
 * Design notes:
 *   - Graceful degradation: if Redis is unavailable or the cache is missing,
 *     every helper returns null/"" and routes fall back to the existing
 *     live-metadata-per-turn behavior.
 *   - The DcSnapshot built from the cache has `truncated: false` (we stored
 *     every surviving DMO), which makes the table-existence preflight
 *     STRICT — exactly the win we want.
 */

import { getRedis } from "@/lib/redis";
import {
  emptyDcSnapshot,
  dcFieldKindFromCompactTy,
  type DcSnapshot,
  type DcTableSchema,
} from "@/lib/llm/dataCloudSchema";

const REDIS_KEY_PREFIX = "dc:metadata:v1:";

export interface CachedDmo {
  name: string;
  displayName?: string;
  category?: string;
  rowCount: number;
  fields: Array<{ name: string; ty?: string }>;
}

export interface CachedDcMetadata {
  generatedAt: string;
  dataspace: string;
  totalDmos: number;
  survivingDmos: number;
  emptyDmos: number;
  errorDmos: number;
  dmos: CachedDmo[];
}

/**
 * Read the cached catalog for a dataspace. Returns null on Redis miss,
 * parse error, or when Redis isn't configured.
 */
export async function loadCachedDcMetadata(
  dataspace: string = "default"
): Promise<CachedDcMetadata | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(`${REDIS_KEY_PREFIX}${dataspace}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDcMetadata;
    if (!parsed || !Array.isArray(parsed.dmos)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Convert the cache envelope into the DcSnapshot shape used by the SQL
 * preflight in lib/llm/heroku.ts. After this the model can fire
 * post_dc_query_sql on the first iteration — the metadata-before-SQL
 * gate will be pre-satisfied and every table/column ref will be
 * strictly verified against the real org schema.
 */
export function toDcSnapshot(envelope: CachedDcMetadata): DcSnapshot {
  const snapshot = emptyDcSnapshot();
  for (const dmo of envelope.dmos) {
    if (!dmo.name) continue;
    const fieldsLc = new Set<string>();
    const fieldsOriginal: string[] = [];
    const fieldKindByLc = new Map<
      string,
      ReturnType<typeof dcFieldKindFromCompactTy> extends null | infer K
        ? NonNullable<K>
        : never
    >();
    for (const f of dmo.fields) {
      if (!f.name) continue;
      fieldsLc.add(f.name.toLowerCase());
      fieldsOriginal.push(f.name);
      const kind = dcFieldKindFromCompactTy(f.ty);
      if (kind)
        fieldKindByLc.set(
          f.name.toLowerCase(),
          kind as NonNullable<typeof kind>
        );
    }
    const schema: DcTableSchema = {
      name: dmo.name,
      displayName: dmo.displayName,
      category: dmo.category,
      fieldsLc,
      fieldsOriginal,
      fieldKindByLc,
    };
    snapshot.tables.set(dmo.name.toLowerCase(), schema);
  }
  snapshot.hasData = snapshot.tables.size > 0;
  snapshot.truncated = false; // full catalog cached — strict preflight
  return snapshot;
}

/**
 * Render the surviving DMO catalog as a compact markdown block injectable
 * into the system prompt. The model reads this at turn start and can pick
 * a table + column directly, skipping the get_dc_metadata tool call.
 *
 * We cap at `maxDmos` (default 200) and prefer the highest-rowCount
 * entries in each banker-relevant category. An empty or missing cache
 * produces "".
 */
export function toSystemPromptSection(
  envelope: CachedDcMetadata | null,
  maxDmos = 200
): string {
  if (!envelope || envelope.dmos.length === 0) return "";

  const topDmos = envelope.dmos.slice(0, maxDmos);
  const categoryCounts = new Map<string, number>();
  for (const d of topDmos) {
    const cat = d.category ?? "Other";
    categoryCounts.set(cat, (categoryCounts.get(cat) ?? 0) + 1);
  }
  const categorySummary = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c} (${n})`)
    .join(", ");

  const lines: string[] = [];
  lines.push(
    `DATA CLOUD CATALOG (pre-loaded from ${envelope.generatedAt}; no get_dc_metadata call needed this turn)`
  );
  lines.push(
    `Dataspace: ${envelope.dataspace} · ${envelope.survivingDmos} DMOs have data (${envelope.emptyDmos} empty + ${envelope.errorDmos} errors filtered out) · by category: ${categorySummary}`
  );
  lines.push(
    `Use these DMO names and field names verbatim in post_dc_query_sql. The runtime preflight will STRICTLY reject any table or column that is not listed here — don't improvise.`
  );
  lines.push("");
  lines.push(
    `Format: <TableName> [category] (rowCount) fields...`
  );
  for (const d of topDmos) {
    const cat = d.category ? ` [${d.category}]` : "";
    const fields = d.fields
      .slice(0, 20)
      .map((f) => (f.ty ? `${f.name}:${f.ty}` : f.name))
      .join(", ");
    const more = d.fields.length > 20 ? `, +${d.fields.length - 20} more` : "";
    lines.push(
      `- ${d.name}${cat} (${d.rowCount.toLocaleString()}): ${fields}${more}`
    );
  }
  if (envelope.dmos.length > maxDmos) {
    lines.push(
      `- …and ${envelope.dmos.length - maxDmos} more (truncated to keep the prompt compact — request a specific DMO via get_dc_metadata ONLY if the table you need isn't in this list).`
    );
  }
  return lines.join("\n");
}
