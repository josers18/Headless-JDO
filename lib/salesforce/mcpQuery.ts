import { connectMcpClients, type McpRegistry, type McpCallResult } from "@/lib/mcp/client";
import { log } from "@/lib/log";

/**
 * Run a SOQL query via the salesforce_crm MCP server.
 *
 * Why not REST directly? The External Client App our banker signs in to is
 * scoped to `mcp_api` only — it does NOT include the standard `api` scope,
 * so direct calls to `/services/data/...` come back as 401. All Salesforce
 * reads from Node routes must go through the MCP server.
 *
 * Tool names on api.salesforce.com sometimes carry a workspace suffix, so we
 * match the first tool whose short name contains "soql" and its input schema
 * accepts a `query` or `q` field. Falls back gracefully to null on any error.
 */

let cachedRegistry: { token: string; registry: McpRegistry } | null = null;

async function getRegistry(token: string): Promise<McpRegistry | null> {
  if (cachedRegistry && cachedRegistry.token === token) {
    return cachedRegistry.registry;
  }
  if (cachedRegistry) {
    await cachedRegistry.registry.close().catch(() => {});
    cachedRegistry = null;
  }
  try {
    const registry = await connectMcpClients({
      salesforceToken: token,
      includeHerokuToolkit: false,
    });
    cachedRegistry = { token, registry };
    return registry;
  } catch (e) {
    log.warn("mcp_query_connect_failed", { err: String(e) });
    return null;
  }
}

let soqlToolName: string | null = null;

async function findSoqlTool(registry: McpRegistry): Promise<string | null> {
  if (soqlToolName) return soqlToolName;
  try {
    const tools = await registry.listAllTools();
    const sfTools = tools.filter((t) => t.server === "salesforce_crm");
    const exact = sfTools.find((t) => /^soqlQuery$/i.test(t.name));
    const prefix = sfTools.find((t) => /^soqlQuery/i.test(t.name));
    const contains = sfTools.find((t) => /soql/i.test(t.name));
    const picked = exact ?? prefix ?? contains;
    if (picked) {
      soqlToolName = picked.qualifiedName;
      return soqlToolName;
    }
  } catch (e) {
    log.warn("mcp_query_list_failed", { err: String(e) });
  }
  return null;
}

function extractRecordsFromMcpResult(r: McpCallResult): Array<Record<string, unknown>> {
  if (r.isError) return [];
  const preview = r.textPreview ?? "";
  if (!preview) return [];
  const attempt = (s: string): Array<Record<string, unknown>> | null => {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
      }
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.records)) {
          return obj.records.filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object"
          );
        }
        if (Array.isArray(obj.result)) {
          return obj.result.filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object"
          );
        }
        if (Array.isArray(obj.rows)) {
          return obj.rows.filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object"
          );
        }
        if (Array.isArray(obj.data)) {
          return obj.data.filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object"
          );
        }
      }
    } catch {
      /* noop */
    }
    return null;
  };
  const direct = attempt(preview);
  if (direct) return direct;
  const first = preview.indexOf("[");
  const firstObj = preview.indexOf("{");
  const start = first === -1 ? firstObj : firstObj === -1 ? first : Math.min(first, firstObj);
  if (start > 0) {
    const sliced = preview.slice(start);
    const second = attempt(sliced);
    if (second) return second;
  }
  return [];
}

export async function runSoqlViaMcp(
  token: string,
  soql: string
): Promise<Array<Record<string, unknown>>> {
  const registry = await getRegistry(token);
  if (!registry) return [];
  const tool = await findSoqlTool(registry);
  if (!tool) {
    log.warn("mcp_query_no_soql_tool");
    return [];
  }
  const attempts: Array<Record<string, unknown>> = [
    { query: soql },
    { q: soql },
    { soql },
  ];
  for (const args of attempts) {
    const res = await registry.callTool(tool, args);
    if (!res.isError) {
      return extractRecordsFromMcpResult(res);
    }
  }
  return [];
}
