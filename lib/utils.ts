import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

export function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

/**
 * Some MCP servers register OpenAI-safe tool names by gluing the workspace
 * slug right after the verb (no `_`), e.g.
 * `getDcMetadatamarketing_data_cloud_queries` on Data 360 or
 * `getSemanticModelsanalytics_tableau_next` on Tableau Next. Those glued
 * slugs leak internal plumbing language ("marketing_data_cloud",
 * "analytics_tableau_next") into the banker-visible Reasoning Trail, so we:
 *   1) split the verb from the slug on display with " · "
 *   2) rewrite jargon-y slugs into something a banker can parse.
 * Dispatch still uses the raw leaf name — this is display-only.
 */
const TOOL_SLUG_LABEL: Array<[RegExp, string]> = [
  [/^marketing_data_cloud_queries$/i, "unified data"],
  [/^analytics_tableau_next$/i, "analytics"],
  [/_data_cloud_queries$/i, "unified data"],
];

const TOOL_VERB_LABEL: Array<[RegExp, string]> = [
  // Keep the verb recognizable but strip "Semantic"-flavored jargon.
  [/^getSemanticModels$/i, "listModels"],
  [/^analyzeSemanticData$/i, "analyze"],
];

function prettifyToolVerb(verb: string): string {
  for (const [re, rep] of TOOL_VERB_LABEL) {
    if (re.test(verb)) return rep;
  }
  return verb;
}

function prettifyToolSlug(slug: string): string {
  for (const [re, rep] of TOOL_SLUG_LABEL) {
    if (re.test(slug)) return rep;
  }
  return slug;
}

export function formatToolLeafForDisplay(tool: string): string {
  // Data 360 — getDcMetadata / postDcQuerySql / queryIndex + "<slug>_data_cloud_queries"
  const d360 = tool.match(
    /^(getDcMetadata|postDcQuerySql|queryIndex)([a-z][a-z0-9_]*_data_cloud_queries)$/i
  );
  if (d360?.[1] && d360[2]) {
    return `${prettifyToolVerb(d360[1])} · ${prettifyToolSlug(d360[2])}`;
  }

  // Tableau Next — e.g. "getSemanticModelsanalytics_tableau_next" or
  // "analyzeSemanticDataanalytics_tableau_next". The slug is a known
  // fixed string glued right after a CamelCase verb. Splitting on the
  // known slug boundary keeps the verb intact (a regex that just looks
  // for "lowercase-run + _tableau_next" backtracks INTO the verb and
  // produces junk like "getSemanticM · odels…").
  const TAB_SLUG = "analytics_tableau_next";
  if (tool.endsWith(TAB_SLUG) && tool.length > TAB_SLUG.length) {
    const verb = tool.slice(0, tool.length - TAB_SLUG.length);
    return `${prettifyToolVerb(verb)} · ${prettifyToolSlug(TAB_SLUG)}`;
  }

  return prettifyToolVerb(tool);
}
