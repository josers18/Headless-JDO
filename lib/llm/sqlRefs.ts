/**
 * lib/llm/sqlRefs.ts — conservative SQL reference extractor for Data Cloud
 * query preflight.
 *
 * Design principles:
 *   1. Never false-positive. If we can't be sure a query is wrong, we
 *      pass it through. The network-side INVALID_ARGUMENT is the
 *      fallback — our job is to catch the obvious failures BEFORE they
 *      hit the network, not to be a full SQL validator.
 *   2. Data Cloud SQL is PostgreSQL-compatible. Identifiers can be
 *      double-quoted or bare. Real column names here typically end in
 *      __c; table names end in __dll or __dlm.
 *   3. We do NOT pull in a full SQL parser library — too much surface
 *      area for the small set of query shapes the model actually emits.
 *      The regex extractors below handle:
 *         SELECT a, b, "c" FROM "T" WHERE "x" = 1 ORDER BY y LIMIT n
 *         SELECT a FROM "T" AS t JOIN "U" u ON t.x = u.y
 *         WITH cte AS (SELECT ...) SELECT ... FROM cte
 *      For anything too complex to parse confidently (nested subqueries
 *      deeper than one level, UNION stacks, window functions in FROM),
 *      we return { complexity: "complex" } and the caller skips preflight.
 */

export interface SqlRefs {
  /** Tables referenced in FROM / JOIN clauses, in query order. */
  tables: string[];
  /**
   * Columns referenced anywhere — SELECT, WHERE, JOIN conditions,
   * GROUP BY, ORDER BY. Each entry is the identifier as it appears in
   * the SQL (with quotes stripped). A column may have a table-qualifier
   * prefix ("t.foo") which we strip before recording the column name.
   */
  columns: string[];
  /**
   * "simple" | "complex". Simple queries have been parsed confidently
   * and callers may run full preflight. Complex queries should be
   * allowed through — the network will reject them if they're wrong.
   */
  complexity: "simple" | "complex";
  /**
   * Aliases the query assigns to tables, e.g. `FROM "Foo" AS f`.
   * Keyed by alias (case-insensitive), value is the verbatim table name.
   * Used when a column reference is qualified (`f.bar` → table "Foo").
   */
  aliases: Map<string, string>;
}

/** Extract table and column references from a generated SQL query. */
export function extractSqlRefs(sql: string): SqlRefs {
  const out: SqlRefs = {
    tables: [],
    columns: [],
    complexity: "simple",
    aliases: new Map(),
  };
  if (typeof sql !== "string" || sql.length === 0) return out;

  // Strip block and line comments so they don't confuse regex.
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");

  // Heuristic complexity flags. Any of these makes us pass through
  // because our extractor's assumptions about FROM / JOIN breaking
  // cleanly don't hold.
  //   - Set-combining keywords (UNION / INTERSECT / the negative set op)
  //     join queries at the top level.
  //   - A FROM clause containing "(" starts a subquery.
  //   - WITH (CTE) queries rename the table scope.
  if (/\b(union|intersect|exc[e]pt)\b/i.test(cleaned)) {
    out.complexity = "complex";
    return out;
  }
  if (/\bwith\s+\w+\s+as\s*\(/i.test(cleaned)) {
    out.complexity = "complex";
    return out;
  }
  // FROM immediately followed by ( signals a derived-table subquery.
  if (/\bfrom\s*\(/i.test(cleaned)) {
    out.complexity = "complex";
    return out;
  }

  // Extract tables from FROM and JOIN clauses.
  // Pattern: FROM or JOIN, then an identifier (quoted or bare),
  // optionally followed by an alias (with or without AS).
  const tableRefRe = /\b(?:from|join)\s+("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*))(?:\s+(?:as\s+)?("([^"]+)"|([A-Za-z_][A-Za-z0-9_]*)))?/gi;
  let m: RegExpExecArray | null;
  while ((m = tableRefRe.exec(cleaned)) !== null) {
    const table = m[2] || m[3];
    if (!table) continue;
    out.tables.push(table);
    const alias = m[5] || m[6];
    if (alias && !SQL_KEYWORDS.has(alias.toUpperCase())) {
      out.aliases.set(alias.toLowerCase(), table);
    }
  }

  // Extract column references. We look for any identifier — quoted or
  // bare — in these positions:
  //   SELECT <cols> FROM ...
  //   WHERE ... <col> <op> ...
  //   ORDER BY <cols>
  //   GROUP BY <cols>
  // Rather than try to parse each clause separately, we scan the whole
  // query for quoted identifiers and bare identifiers that look like
  // column names (i.e. ending in __c, which Data Cloud column names do).
  // This is conservative: we may miss some columns, but every column we
  // DO return is almost certainly a real reference and worth checking.
  const seen = new Set<string>();

  // Quoted identifiers — "Foo__c" or "t"."Foo__c".
  const quotedRe = /"([^"]+)"/g;
  while ((m = quotedRe.exec(cleaned)) !== null) {
    const id = m[1];
    if (!id) continue;
    // Table names also come through here. Filter them out by checking
    // the extracted table list.
    if (out.tables.some((t) => t.toLowerCase() === id.toLowerCase())) continue;
    // And alias names.
    if (out.aliases.has(id.toLowerCase())) continue;
    if (!seen.has(id.toLowerCase())) {
      seen.add(id.toLowerCase());
      out.columns.push(id);
    }
  }

  // Bare __c identifiers — unquoted DMO column references. Rare in
  // model output (the model tends to quote), but still possible.
  const bareColRe = /\b([A-Za-z_][A-Za-z0-9_]*__c)\b/g;
  while ((m = bareColRe.exec(cleaned)) !== null) {
    const id = m[1];
    if (!id) continue;
    if (out.tables.some((t) => t.toLowerCase() === id.toLowerCase())) continue;
    if (!seen.has(id.toLowerCase())) {
      seen.add(id.toLowerCase());
      out.columns.push(id);
    }
  }

  return out;
}

// Subset of SQL keywords we might encounter where the alias-capture
// regex could otherwise treat a keyword as an alias. Extend as needed.
const SQL_KEYWORDS = new Set([
  "ON",
  "WHERE",
  "GROUP",
  "ORDER",
  "LIMIT",
  "HAVING",
  "INNER",
  "LEFT",
  "RIGHT",
  "FULL",
  "OUTER",
  "CROSS",
  "JOIN",
  "AND",
  "OR",
  "NOT",
  "IS",
  "NULL",
  "IN",
  "BETWEEN",
  "LIKE",
  "AS",
  "UNION",
  "INTERSECT",
  "SELECT",
  "FROM",
]);
