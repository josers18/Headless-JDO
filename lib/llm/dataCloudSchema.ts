/**
 * lib/llm/dataCloudSchema.ts — per-turn schema snapshot for Data Cloud.
 *
 * Populated from successful `getDcMetadata*` tool responses. Consumed by
 * the Data Cloud SQL preflight to verify that `FROM` tables and SELECT /
 * WHERE / ORDER BY columns referenced in a model-generated SQL query
 * actually exist in the org's metadata.
 *
 * The snapshot is strictly additive across a single turn — multiple
 * metadata calls (different dataspaces or filters) merge their tables
 * together. Nothing here is persisted; each new turn starts empty.
 *
 * Design choices:
 *   - Parse the JSON string the MCP server returned (already flattened
 *     into `modelText` by client.ts). If the response was truncated we
 *     parse what we can and record the remainder as unknown.
 *   - Store case-insensitive name indexes for O(1) lookup against
 *     model-generated identifiers which are often quoted verbatim with
 *     mixed case.
 *   - Never throw. If parsing fails we return an empty snapshot and
 *     callers skip preflight rather than blocking valid queries.
 */

/** Narrow field kind for WHERE-clause sanity checks (from MCP type strings). */
export type DcFieldKind =
  | "boolean"
  | "text"
  | "number"
  | "date"
  | "unknown";

export interface DcTableSchema {
  /** Verbatim API name from metadata (e.g. "UnifiedIndividual__dlm"). */
  name: string;
  /** Human display name from metadata, if present. */
  displayName?: string;
  /** Set of field API names in this table. Lower-cased for matching. */
  fieldsLc: Set<string>;
  /** Original-case field names, kept for rejection messages. */
  fieldsOriginal: string[];
  /** Lower-cased field API name → coarse type for SQL preflight. */
  fieldKindByLc: Map<string, DcFieldKind>;
  /** Category tag from metadata (Profile / Engagement / Related / etc.). */
  category?: string;
}

export interface DcSnapshot {
  /** Lower-case table name -> table schema. */
  tables: Map<string, DcTableSchema>;
  /** Was any parsed metadata truncated? Affects how strict preflight is. */
  truncated: boolean;
  /** True if at least one successful getDcMetadata call was merged in. */
  hasData: boolean;
}

export function emptyDcSnapshot(): DcSnapshot {
  return { tables: new Map(), truncated: false, hasData: false };
}

/** Map Salesforce / Data Cloud field metadata strings → coarse kinds. */
export function classifyDcFieldKind(raw: unknown): DcFieldKind {
  const s = String(raw ?? "")
    .toLowerCase()
    .trim();
  if (!s) return "unknown";
  if (/\b(bool|checkbox|boolean)\b/i.test(s)) return "boolean";
  if (/int|double|currency|percent|number|decimal|long/i.test(s))
    return "number";
  if (/date|time/i.test(s)) return "date";
  if (
    /string|text|email|phone|url|picklist|multipicklist|textarea|encryptedstring/i.test(
      s
    )
  )
    return "text";
  return "unknown";
}

/** Compact single-letter ty from MCP projection (see client.ts compactDcMetadataText). */
export function dcFieldKindFromCompactTy(ty: unknown): DcFieldKind | null {
  if (typeof ty !== "string" || ty.length !== 1) return null;
  switch (ty.toUpperCase()) {
    case "B":
      return "boolean";
    case "T":
      return "text";
    case "N":
      return "number";
    case "D":
      return "date";
    default:
      return null;
  }
}

/** Single-character ty for compact metadata JSON (token-efficient). */
export function dcFieldKindToCompactTy(k: DcFieldKind): string | undefined {
  if (k === "boolean") return "B";
  if (k === "text") return "T";
  if (k === "number") return "N";
  if (k === "date") return "D";
  return undefined;
}

/**
 * Merge a getDcMetadata response into an existing snapshot. Called by
 * the dispatcher in lib/llm/heroku.ts on every successful metadata call.
 * Safe to call with arbitrary JSON text — parsing failures degrade
 * silently (snapshot stays unchanged except for the truncated flag if
 * the input carried our truncation marker).
 */
export function ingestDcMetadata(snapshot: DcSnapshot, modelText: string): void {
  if (typeof modelText !== "string" || modelText.length === 0) return;

  // Truncation marker is appended by client.ts extractTextPreview when a
  // response exceeds the per-tool budget. When present, preflight should
  // be lenient: unknown tables might just be past the truncation point.
  if (/\[RESPONSE TRUNCATED at /.test(modelText)) {
    snapshot.truncated = true;
  }

  // Strip the truncation marker before JSON.parse (otherwise parse fails).
  const jsonText = modelText.replace(
    /\n\n\[RESPONSE TRUNCATED at [\s\S]*$/,
    ""
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    // getDcMetadata responses are supposed to be JSON; if parsing fails
    // we've either hit truncation mid-object or the MCP server returned
    // something unexpected. Either way we can't index it — skip.
    return;
  }

  // Shape observed in live traces:
  //   { "metadata": [ { "name": "Foo__dll", "fields": [...], "category": "..." }, ... ] }
  // Some variants may use "objects" or return the array at the root.
  // Handle all three defensively.
  const rows = pickMetadataArray(parsed);
  if (!rows) return;

  let ingested = 0;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const obj = row as Record<string, unknown>;
    const name = typeof obj.name === "string" ? obj.name : undefined;
    if (!name) continue;
    const displayName =
      typeof obj.displayName === "string" ? obj.displayName : undefined;
    const category =
      typeof obj.category === "string" ? obj.category : undefined;

    const fieldsRaw = Array.isArray(obj.fields) ? obj.fields : [];
    const fieldsOriginal: string[] = [];
    const fieldsLc = new Set<string>();
    const fieldKindByLc = new Map<string, DcFieldKind>();
    for (const f of fieldsRaw) {
      if (!f || typeof f !== "object") continue;
      const fr = f as Record<string, unknown>;
      const fn = fr.name;
      if (typeof fn !== "string" || fn.length === 0) continue;
      const fromTy = dcFieldKindFromCompactTy(fr.ty);
      const kind: DcFieldKind =
        fromTy ?? classifyDcFieldKind(fr.type ?? fr.dataType ?? fr.data_type);
      const fnLc = fn.toLowerCase();
      fieldsOriginal.push(fn);
      fieldsLc.add(fnLc);
      fieldKindByLc.set(fnLc, kind);
    }

    const nameLc = name.toLowerCase();
    const existing = snapshot.tables.get(nameLc);
    if (existing) {
      // Merge — later metadata calls may enumerate more fields on the
      // same table (different dataspace, different filter).
      for (let i = 0; i < fieldsOriginal.length; i++) {
        const fo = fieldsOriginal[i];
        if (typeof fo !== "string") continue;
        const foLc = fo.toLowerCase();
        const kn = fieldKindByLc.get(foLc);
        if (!existing.fieldsLc.has(foLc)) {
          existing.fieldsOriginal.push(fo);
          existing.fieldsLc.add(foLc);
          if (kn !== undefined) existing.fieldKindByLc.set(foLc, kn);
        } else if (kn !== undefined && kn !== "unknown") {
          existing.fieldKindByLc.set(foLc, kn);
        }
      }
      if (!existing.category && category) existing.category = category;
      if (!existing.displayName && displayName) existing.displayName = displayName;
    } else {
      snapshot.tables.set(nameLc, {
        name,
        displayName,
        fieldsLc,
        fieldsOriginal,
        fieldKindByLc,
        category,
      });
    }
    ingested++;
  }
  if (ingested > 0) snapshot.hasData = true;
}

function pickMetadataArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.metadata)) return obj.metadata;
  if (Array.isArray(obj.objects)) return obj.objects;
  if (Array.isArray(obj.items)) return obj.items;
  return null;
}

/**
 * Does the snapshot contain a table by this name (case-insensitive)?
 * Accepts the name with or without surrounding double quotes, which is
 * the shape model-generated SQL uses most often.
 */
export function hasTable(snapshot: DcSnapshot, name: string): boolean {
  if (!name) return false;
  return snapshot.tables.has(stripQuotes(name).toLowerCase());
}

export function getTable(snapshot: DcSnapshot, name: string): DcTableSchema | undefined {
  if (!name) return undefined;
  return snapshot.tables.get(stripQuotes(name).toLowerCase());
}

function stripQuotes(s: string): string {
  const trimmed = s.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"'))
    return trimmed.slice(1, -1);
  return trimmed;
}

/**
 * Suggest up to `limit` table names that most closely match `needle` —
 * used in rejection messages so the model has real candidates to pick
 * from instead of being told only that its guess was wrong. Matching
 * is case-insensitive substring, falling back to "any N tables we've
 * seen" when no substring match exists.
 */
export function suggestTables(
  snapshot: DcSnapshot,
  needle: string,
  limit = 5
): string[] {
  const all = [...snapshot.tables.values()];
  if (all.length === 0) return [];
  const n = stripQuotes(needle).toLowerCase();
  const tokens = n.split(/[^a-z0-9]+/i).filter((t) => t.length >= 3);

  const scored = all
    .map((t) => {
      const nameLc = t.name.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (nameLc.includes(tok)) score += tok.length;
      }
      return { name: t.name, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.name);

  if (scored.length > 0) return scored;
  return all.slice(0, limit).map((t) => t.name);
}

export function suggestColumns(
  table: DcTableSchema,
  needle: string,
  limit = 5
): string[] {
  const all = table.fieldsOriginal;
  if (all.length === 0) return [];
  const n = stripQuotes(needle).toLowerCase();
  const tokens = n.split(/[^a-z0-9]+/i).filter((t) => t.length >= 3);

  const scored = all
    .map((f) => {
      const lc = f.toLowerCase();
      let score = 0;
      for (const tok of tokens) {
        if (lc.includes(tok)) score += tok.length;
      }
      return { name: f, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.name);

  if (scored.length > 0) return scored;
  return all.slice(0, limit);
}
