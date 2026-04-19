/**
 * lib/mcp/client.ts — thin wrapper over the official MCP SDK client.
 *
 * Opens one StreamableHTTP-backed `Client` per Salesforce-hosted MCP server,
 * bearer-authed with a Salesforce access token. Exposes:
 *   - connectMcpClients(token): Promise<McpRegistry>
 *   - McpRegistry.listAllTools()
 *   - McpRegistry.callTool(qualifiedName, args)
 *   - McpRegistry.close()
 *
 * Qualified tool names use a `__` (double underscore) separator, e.g.
 *   salesforce_crm__get_record
 *   data_360__execute_query
 *   tableau_next__analyze_data
 * That's the stable string we hand to the LLM and accept back in tool_calls.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerName } from "@/types/horizon";
import { MCP_URLS } from "@/lib/anthropic/mcp-servers";
import { log } from "@/lib/log";

const TOOL_SEP = "__";

export interface McpToolDef {
  server: McpServerName;
  name: string;
  qualifiedName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpCallResult {
  server: McpServerName;
  tool: string;
  isError: boolean;
  content: unknown;
  textPreview: string;
}

export interface McpRegistry {
  servers: McpServerName[];
  listAllTools(): Promise<McpToolDef[]>;
  callTool(qualifiedName: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}

const SF_SERVERS: ReadonlyArray<McpServerName> = [
  "salesforce_crm",
  "data_360",
  "tableau_next",
] as const;

interface EndpointSpec {
  url: string;
  /**
   * `streamable` = modern MCP Streamable HTTP (single POST-able endpoint).
   * `sse`        = legacy MCP SSE transport (GET /sse → event: endpoint, then
   *                 POST /message?sessionId=...).
   * `auto`       = try streamable first, fall back to sse on 405/404.
   */
  transport: "streamable" | "sse" | "auto";
}

function endpointFor(server: McpServerName): EndpointSpec {
  if (server === "heroku_toolkit") {
    const base = (process.env.INFERENCE_URL ?? "").replace(/\/$/, "");
    return { url: `${base}/mcp/sse`, transport: "sse" };
  }
  // SF hosted MCPs at api.salesforce.com speak Streamable HTTP.
  return { url: MCP_URLS[server], transport: "auto" };
}

async function buildTransport(
  spec: EndpointSpec,
  token: string,
  signal: AbortSignal | undefined
): Promise<Transport> {
  const authHeader: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const url = new URL(spec.url);

  if (spec.transport === "sse") {
    return new SSEClientTransport(url, {
      requestInit: { headers: authHeader, signal },
      eventSourceInit: {
        // why: EventSource by default does not send Authorization. The MCP
        // SDK intercepts the fetch; we still pass our headers via requestInit
        // above, but the EventSource initiator also needs the token. Providing
        // a fetch override here ensures the SSE GET is authed.
        fetch: (u, init) =>
          fetch(u, {
            ...init,
            headers: { ...(init?.headers ?? {}), ...authHeader },
          }),
      },
    });
  }

  // streamable or auto → start with StreamableHTTP.
  return new StreamableHTTPClientTransport(url, {
    requestInit: { headers: authHeader, signal },
  });
}

async function openOne(
  server: McpServerName,
  token: string,
  signal?: AbortSignal
): Promise<Client> {
  const spec = endpointFor(server);
  const connect = async (transport: Transport) => {
    const client = new Client(
      { name: "horizon", version: "0.1.0" },
      { capabilities: {} }
    );
    await client.connect(transport);
    return client;
  };

  try {
    return await connect(await buildTransport(spec, token, signal));
  } catch (err) {
    // Fallback: if auto and Streamable failed with 4xx that looks like "wrong
    // transport" (405 Method Not Allowed, 404 Not Found on /), try SSE.
    if (spec.transport === "auto" && isTransportMismatch(err)) {
      log.info("mcp.transport.fallback", { server, from: "streamable", to: "sse" });
      const sseUrl = deriveSseUrl(spec.url);
      const sseTransport = await buildTransport(
        { url: sseUrl, transport: "sse" },
        token,
        signal
      );
      return await connect(sseTransport);
    }
    throw err;
  }
}

function isTransportMismatch(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b40[45]\b|Method not allowed|Method Not Allowed/i.test(msg);
}

function deriveSseUrl(streamableUrl: string): string {
  // Heuristic: if the streamable URL ends at `/mcp`, legacy SSE lives at
  // `/mcp/sse`. Otherwise leave as-is.
  if (streamableUrl.endsWith("/mcp")) return `${streamableUrl}/sse`;
  return streamableUrl;
}

export interface ConnectOptions {
  /** Salesforce bearer for the 3 SF MCPs. Required. */
  salesforceToken: string;
  /** Include the Heroku Inference toolkit as a 4th MCP server if INFERENCE_* are set. */
  includeHerokuToolkit?: boolean;
  /** Abort in-flight connects. */
  signal?: AbortSignal;
}

export async function connectMcpClients(
  opts: ConnectOptions
): Promise<McpRegistry> {
  const { salesforceToken, includeHerokuToolkit = true, signal } = opts;

  const plan: Array<{ server: McpServerName; token: string }> = SF_SERVERS.map(
    (s) => ({ server: s, token: salesforceToken })
  );
  const inferenceKey = process.env.INFERENCE_KEY;
  if (
    includeHerokuToolkit &&
    inferenceKey &&
    process.env.INFERENCE_URL
  ) {
    plan.push({ server: "heroku_toolkit", token: inferenceKey });
  }

  // Connect in parallel; surface partial failures as warnings, not fatals.
  const settled = await Promise.allSettled(
    plan.map(({ server, token }) =>
      openOne(server, token, signal).then((c) => ({ server, client: c }))
    )
  );
  const clients = new Map<McpServerName, Client>();
  for (let i = 0; i < settled.length; i++) {
    const entry = settled[i];
    const planned = plan[i];
    if (!entry || !planned) continue;
    if (entry.status === "fulfilled") {
      clients.set(entry.value.server, entry.value.client);
    } else {
      log.warn("mcp.connect.failed", {
        server: planned.server,
        error: String(entry.reason),
      });
    }
  }

  if (clients.size === 0) {
    throw new Error("mcp: no servers connected");
  }

  // Cache of qualified-name → server+tool-name for fast dispatch.
  let toolIndex: Map<string, { server: McpServerName; name: string }> | null =
    null;

  async function listAllTools(): Promise<McpToolDef[]> {
    const out: McpToolDef[] = [];
    const idx = new Map<string, { server: McpServerName; name: string }>();
    await Promise.all(
      [...clients.entries()].map(async ([server, c]) => {
        try {
          const res = await c.listTools();
          for (const t of res.tools) {
            const qualifiedName = `${server}${TOOL_SEP}${t.name}`;
            out.push({
              server,
              name: t.name,
              qualifiedName,
              description: t.description,
              inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
                type: "object",
                properties: {},
              },
            });
            idx.set(qualifiedName, { server, name: t.name });
          }
        } catch (e) {
          log.warn("mcp.listTools.failed", {
            server,
            error: String(e),
          });
        }
      })
    );
    toolIndex = idx;
    return out;
  }

  async function callTool(
    qualifiedName: string,
    args: Record<string, unknown>
  ): Promise<McpCallResult> {
    if (!toolIndex) await listAllTools();
    const entry = toolIndex?.get(qualifiedName);
    if (!entry) {
      // Accept raw names as a last resort: split on __ if present.
      const i = qualifiedName.indexOf(TOOL_SEP);
      if (i > 0) {
        const server = qualifiedName.slice(0, i) as McpServerName;
        const name = qualifiedName.slice(i + TOOL_SEP.length);
        return callViaClient(server, name, args);
      }
      throw new Error(`mcp: unknown tool ${qualifiedName}`);
    }
    return callViaClient(entry.server, entry.name, args);
  }

  async function callViaClient(
    server: McpServerName,
    name: string,
    args: Record<string, unknown>
  ): Promise<McpCallResult> {
    const c = clients.get(server);
    if (!c) throw new Error(`mcp: server ${server} not connected`);
    try {
      const res = await c.callTool({ name, arguments: args });
      // MCP content is an array of TextContent | ImageContent | etc.
      const content = res.content as unknown;
      const textPreview = extractTextPreview(content);
      const isError = res.isError === true;
      return { server, tool: name, isError, content, textPreview };
    } catch (e) {
      return {
        server,
        tool: name,
        isError: true,
        content: null,
        textPreview: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async function close() {
    await Promise.allSettled(
      [...clients.values()].map((c) => c.close().catch(() => {}))
    );
  }

  return {
    servers: [...clients.keys()],
    listAllTools,
    callTool,
    close,
  };
}

function extractTextPreview(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content).slice(0, 500);
  const texts: string[] = [];
  for (const part of content) {
    const p = part as { type?: string; text?: string };
    if (p?.type === "text" && typeof p.text === "string") {
      texts.push(p.text);
    }
  }
  if (texts.length === 0) return JSON.stringify(content).slice(0, 500);
  return texts.join("\n").slice(0, 2000);
}

export const MCP_TOOL_SEP = TOOL_SEP;
