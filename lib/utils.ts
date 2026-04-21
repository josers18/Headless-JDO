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
 * MCP Data 360 registers OpenAI-safe tool names by gluing the workspace slug
 * right after the verb (no `_`), e.g. `getDcMetadatamarketing_data_cloud_queries`.
 * Split on display only — dispatch still uses the raw leaf name.
 */
export function formatToolLeafForDisplay(tool: string): string {
  const m = tool.match(
    /^(getDcMetadata|postDcQuerySql|queryIndex)([a-z][a-z0-9_]*_data_cloud_queries)$/i
  );
  if (m?.[1] && m[2]) return `${m[1]} · ${m[2]}`;
  return tool;
}
