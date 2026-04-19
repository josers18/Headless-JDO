/**
 * lib/mcp/tools.ts — convert MCP tool defs → OpenAI `function` tools.
 *
 * Heroku Inference speaks OpenAI's /v1/chat/completions schema. This file
 * takes our cross-server McpToolDef list and produces the `tools` array that
 * Heroku expects, plus helpers to read tool calls back.
 */

import type { McpToolDef } from "./client";
import type { McpServerName } from "@/types/horizon";
import { MCP_TOOL_SEP } from "./client";

export interface OpenAiFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI (and Heroku Inference) limits tool names to ^[a-zA-Z0-9_-]{1,64}$.
 * MCP servers have looser rules. Sanitize aggressively and de-duplicate.
 */
export function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

export function toOpenAiTools(defs: McpToolDef[]): OpenAiFunctionTool[] {
  const seen = new Set<string>();
  const out: OpenAiFunctionTool[] = [];
  for (const d of defs) {
    let name = sanitizeToolName(d.qualifiedName);
    if (!name) continue;
    if (seen.has(name)) {
      let i = 2;
      while (seen.has(`${name}_${i}`)) i++;
      name = `${name}_${i}`;
    }
    seen.add(name);
    const params = normalizeParameters(d.inputSchema);
    out.push({
      type: "function",
      function: {
        name,
        description: d.description?.slice(0, 1024),
        parameters: params,
      },
    });
  }
  return out;
}

/**
 * Parse `salesforce_crm__get_record` → { server: 'salesforce_crm', name: 'get_record' }.
 * Returns null if the qualified prefix doesn't match a known server.
 */
export function parseToolName(
  qualified: string
): { server: McpServerName; name: string } | null {
  const known: McpServerName[] = [
    "salesforce_crm",
    "data_360",
    "tableau_next",
    "heroku_toolkit",
  ];
  for (const s of known) {
    const prefix = `${s}${MCP_TOOL_SEP}`;
    if (qualified.startsWith(prefix)) {
      return { server: s, name: qualified.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Ensure the parameters object is a valid JSON-Schema `object`. OpenAI requires
 * at least `{type: "object"}`; some MCP servers return schemas with missing
 * `type` or empty properties which would 400 on Heroku's side.
 */
function normalizeParameters(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }
  const s = { ...(schema as Record<string, unknown>) };
  if (s.type !== "object") s.type = "object";
  if (typeof s.properties !== "object" || s.properties === null) {
    s.properties = {};
  }
  return s;
}
