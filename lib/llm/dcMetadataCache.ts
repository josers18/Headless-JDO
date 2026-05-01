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
 * Regex matching DMO names a relationship banker would plausibly query.
 * Matches common FSC / financial service entity families plus unified-
 * profile and engagement shapes. The match is CASE-INSENSITIVE and
 * applies to the name anywhere in the string, so both
 * `Financial_Accounts__dlm` and `FinancialAccountHistory__dll` hit.
 *
 * Banker-relevant buckets:
 *   - Financial / FinServ* / Finance — financial accounts, holdings, goals
 *   - Account / Client / Contact / Household / Party — identity primitives
 *   - Opportunity / Lead / Deal / Pipeline — sales surface
 *   - Transaction / Trade / Wire / Ach / Balance — movements
 *   - Engagement / Activity / Interaction / Touchpoint — digital signals
 *   - LifeEvent / PersonLifeEvent — client moments
 *   - UnifiedIndividual / Individual / Identity / Profile — canonical shape
 *   - Case / Ticket / Complaint / Service — relationship maintenance
 */
const BANKER_RELEVANT_NAME_RE =
  /financial|finserv|finance|account|client|contact|household|party|opportunity|lead|deal|pipeline|transaction|trade|wire|ach|balance|engagement|activity|interaction|touchpoint|lifeevent|person[_]?life|unifiedindividual|unified[_]?individual|identity|profile|case|ticket|complaint|service/i;

function isBankerRelevant(name: string, category?: string): boolean {
  if (BANKER_RELEVANT_NAME_RE.test(name)) return true;
  // Accept category-level inclusion for Profile tables even if the
  // name doesn't match the heuristic — they're canonical for FSC.
  if (category === "Profile") return true;
  return false;
}

/**
 * Render the surviving DMO catalog as a compact markdown block injectable
 * into the system prompt. The model reads this at turn start and can pick
 * a table + column directly, skipping the get_dc_metadata tool call.
 *
 * Filtering strategy (Option C — tight + banker-relevant):
 *   1. Partition into banker-relevant vs everything-else via name+category.
 *   2. Take the top `bankerCap` (default 60) banker-relevant by rowCount.
 *   3. Append `overflowCap` (default 10) highest-rowCount catch-all rows.
 *   4. Total cap ~70 rows ≈ ~5–8KB of prompt — small enough that the model
 *      actually reads table names verbatim instead of skimming.
 */
export function toSystemPromptSection(
  envelope: CachedDcMetadata | null,
  opts: { bankerCap?: number; overflowCap?: number } = {}
): string {
  if (!envelope || envelope.dmos.length === 0) return "";
  const bankerCap = opts.bankerCap ?? 60;
  const overflowCap = opts.overflowCap ?? 10;

  // Envelope.dmos is already sorted by rowCount desc from the refresh job.
  const bankerRelevant = envelope.dmos
    .filter((d) => isBankerRelevant(d.name, d.category))
    .slice(0, bankerCap);
  const bankerSet = new Set(bankerRelevant.map((d) => d.name));
  const overflow = envelope.dmos
    .filter((d) => !bankerSet.has(d.name))
    .slice(0, overflowCap);

  const shown = [...bankerRelevant, ...overflow];
  const categoryCounts = new Map<string, number>();
  for (const d of shown) {
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
    `Dataspace: ${envelope.dataspace} · ${envelope.survivingDmos} DMOs total have data; the ${shown.length} banker-relevant ones are listed below (sorted by row count desc).`
  );
  lines.push(
    `Categories shown: ${categorySummary} · ${envelope.emptyDmos} empty + ${envelope.errorDmos} errored DMOs were filtered out during refresh.`
  );
  lines.push("");
  lines.push(
    `RULES (STRICT — the runtime preflight enforces these):`
  );
  lines.push(
    `- Copy DMO table names VERBATIM from this list — every underscore, every __dll/__dlm suffix, case-sensitive. Do NOT improvise variants (no "_Snow__dlm" when the list has "_Snow_XL__dll").`
  );
  lines.push(
    `- Copy field names VERBATIM from the listed fields. The ":ty" suffix is a compact kind hint: T=text, N=number, B=boolean, D=date. It's NOT part of the column name — drop it in SQL.`
  );
  lines.push(
    `- If the table you need isn't listed here, say so and move on — do NOT guess. This list already filtered to ${envelope.survivingDmos} DMOs with real data across ${envelope.totalDmos} total; if it's not here it either has 0 rows or isn't banker-relevant.`
  );
  lines.push("");
  lines.push(
    `Format: <TableName> [category] (rowCount) — fields...`
  );
  const FIELDS_PER_DMO = 12;
  for (const d of shown) {
    const cat = d.category ? ` [${d.category}]` : "";
    const fields = d.fields
      .slice(0, FIELDS_PER_DMO)
      .map((f) => (f.ty ? `${f.name}:${f.ty}` : f.name))
      .join(", ");
    const more =
      d.fields.length > FIELDS_PER_DMO
        ? `, +${d.fields.length - FIELDS_PER_DMO} more`
        : "";
    lines.push(
      `- ${d.name}${cat} (${d.rowCount.toLocaleString()}) — ${fields}${more}`
    );
  }
  const unshownCount = envelope.dmos.length - shown.length;
  if (unshownCount > 0) {
    lines.push(
      `- …and ${unshownCount} more non-banker-relevant DMOs not shown (experimentation cohorts, embeddings, directory tables, etc.).`
    );
  }
  return lines.join("\n");
}
