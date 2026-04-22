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
import {
  classifyDcFieldKind,
  dcFieldKindToCompactTy,
} from "@/lib/llm/dataCloudSchema";
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
  // Short, UI-facing preview (≤ 2KB). Safe to display in the reasoning trail.
  textPreview: string;
  // Full-size payload the model sees as tool-result content. Larger than
  // textPreview so the model does not have to work from a truncated view
  // — critical for schema-introspection tools like data_360.getDcMetadata
  // whose responses contain dozens of DMOs and would be cut off mid-table
  // at 2KB, forcing the model to hallucinate table/column names from
  // training. Bounded to keep us inside Heroku Inference's context window.
  modelText: string;
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
  const failedSf: Array<{ server: McpServerName; error: string }> = [];
  for (let i = 0; i < settled.length; i++) {
    const entry = settled[i];
    const planned = plan[i];
    if (!entry || !planned) continue;
    if (entry.status === "fulfilled") {
      clients.set(entry.value.server, entry.value.client);
    } else {
      const errStr = String(entry.reason);
      log.warn("mcp.connect.failed", {
        server: planned.server,
        error: errStr,
      });
      if (SF_SERVERS.includes(planned.server)) {
        failedSf.push({ server: planned.server, error: errStr });
      }
    }
  }

  if (clients.size === 0) {
    throw new Error("mcp: no servers connected");
  }

  // why: if ALL Salesforce MCPs failed but heroku_toolkit succeeded, the
  // registry is non-empty and the agent loop proceeds silently with only
  // generic toolkit tools — the LLM then has no way to answer CRM / Data
  // Cloud / Tableau questions, so it hallucinates plausible-sounding
  // answers with fabricated client names and Salesforce Ids. That footgun
  // is a demo-killer; we detected it in the live Heroku logs when a stale
  // probe token triggered 3× `Invalid token` responses followed by a
  // successful `ask.done` with tools=0.
  //
  // When every SF server fails with an auth-looking error, throw a clear
  // re-auth message. makeSseStream surfaces this as the error event and
  // the client's 401 handler prompts a /api/connect trip.
  const anySfConnected = SF_SERVERS.some((s) => clients.has(s));
  if (!anySfConnected && failedSf.length > 0) {
    const authShaped = failedSf.some(({ error }) =>
      /invalid token|unauthorized|401|expired|forbidden|403/i.test(error)
    );
    const msg = authShaped
      ? "Salesforce session expired. Visit /api/connect to reactivate."
      : `Salesforce MCP servers unreachable (${failedSf.map((f) => f.server).join(", ")}). Check network / ECA config.`;
    // Best-effort close the toolkit client so we don't leak it.
    await Promise.allSettled(
      [...clients.values()].map((c) => c.close().catch(() => {}))
    );
    throw new Error(msg);
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
      const textPreview = extractTextPreview(content, 2_000);
      // Two-stage compaction for modelText:
      //   1. Per-tool compact projection — drops fields the model does
      //      not need (displayName, primaryKeys, category, field types)
      //      while keeping everything required for schema-grounded SQL.
      //      Cuts getDcMetadata payload ~70% so one turn no longer
      //      blows through Heroku Inference's 800K tokens-per-minute
      //      quota. No-op for other tools.
      //   2. Budget slice + truncation marker — same as before.
      const projected = projectForModel(server, name, content);
      const modelText = extractTextPreview(projected, modelBudgetFor(server, name));
      const isError = res.isError === true;
      return { server, tool: name, isError, content, textPreview, modelText };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        server,
        tool: name,
        isError: true,
        content: null,
        textPreview: msg,
        modelText: msg,
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

function extractTextPreview(content: unknown, maxChars: number): string {
  const raw = flattenTextContent(content);
  if (raw.length <= maxChars) return raw;
  // Silent truncation is the exact failure we spent today fixing — the
  // model ends up guessing at schema because it thinks the response is
  // complete. Append an explicit marker so the model knows more data
  // exists and can narrow the next call (e.g. by DMO category).
  const truncatedNote = `\n\n[RESPONSE TRUNCATED at ${maxChars.toLocaleString()} chars — ${raw.length.toLocaleString()} total. Re-call this tool with narrower arguments (e.g. a category filter or a specific object name) to see the remainder.]`;
  return raw.slice(0, maxChars - truncatedNote.length) + truncatedNote;
}

function flattenTextContent(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content);
  const texts: string[] = [];
  for (const part of content) {
    const p = part as { type?: string; text?: string };
    if (p?.type === "text" && typeof p.text === "string") {
      texts.push(p.text);
    }
  }
  if (texts.length === 0) return JSON.stringify(content);
  return texts.join("\n");
}

// Per-tool model-text budget. Schema-introspection responses (getDcMetadata,
// describeSObject, list-DMOs, etc.) contain dense, non-redundant structure
// the model must read to avoid hallucinating tables and columns.
//
// Sizing is constrained by TWO things, not just context window:
//   - 200K-token context window (~800K chars of JSON)
//   - 800K tokens-per-minute Heroku Inference quota, shared across ALL
//     tool calls in the turn plus system prompt, prior-turn history,
//     and the model's output. A single Pulse turn can easily stack
//     3–5 tool calls plus prior context plus output — at 40K tokens
//     per schema response we trip the TPM quota within two-to-three
//     regenerations per minute.
//
// Mitigation: projectForModel() compacts getDcMetadata to
// { name, fields: [name] } shape (dropping displayName, primaryKeys,
// category, field types) so each DMO entry shrinks from ~400 bytes to
// ~80 bytes — about a 5x reduction. After that projection, 64KB of
// text holds ~800 DMOs with ~50 fields each, which covers every real
// org we expect. Larger responses still get a truncation marker and
// the model is instructed to narrow the next call.
const METADATA_BUDGET_CHARS = 64_000;
const SCHEMA_BUDGET_CHARS = 32_000;
const DEFAULT_BUDGET_CHARS = 2_000;

function modelBudgetFor(server: McpServerName, tool: string): number {
  if (server === "data_360" && /^getDcMetadata/i.test(tool))
    return METADATA_BUDGET_CHARS;
  if (
    server === "salesforce_crm" &&
    /^(describeSObject|getObjectSchema)/i.test(tool)
  )
    return SCHEMA_BUDGET_CHARS;
  return DEFAULT_BUDGET_CHARS;
}

/**
 * Project a tool response into the minimum shape the model needs
 * before it is sliced to budget. For most tools this is the identity
 * — the caller's prompt has told the model to read the raw payload,
 * and we must not lie about what the MCP returned.
 *
 * For getDcMetadata specifically, the response has a dense, fixed
 * shape and the model only needs names to write SQL and to refer to
 * tables/columns in prose. displayName, primaryKeys, category, and
 * field types are noise the preflight re-derives from the SQL itself
 * and that the narrative never quotes. We strip them to reclaim
 * tokens against the TPM quota. The projection is lossless for SQL
 * correctness — every table name and every field name survives.
 */
function projectForModel(
  server: McpServerName,
  tool: string,
  content: unknown
): unknown {
  if (!(server === "data_360" && /^getDcMetadata/i.test(tool))) return content;
  if (!Array.isArray(content)) return content;
  const out: unknown[] = [];
  for (const part of content) {
    const p = part as { type?: string; text?: string };
    if (p?.type !== "text" || typeof p.text !== "string") {
      out.push(part);
      continue;
    }
    out.push({ type: "text", text: compactDcMetadataText(p.text) });
  }
  return out;
}

/**
 * Rewrite a getDcMetadata JSON string down to roughly
 *   { metadata: [ { name, fields: [ { name, ty? } ] } ] }
 * preserving array order so the dataCloudSchema snapshot ingest still
 * works and so the model sees the org's tables in the same sequence
 * as the raw response. Parse failures fall back to the original text
 * — we never want compression to silently hide schema from the model.
 */
function compactDcMetadataText(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as unknown;
    const rows = pickDcMetadataArray(parsed);
    if (!rows) return rawText;
    const compact = rows.map((row) => {
      if (!row || typeof row !== "object") return row;
      const r = row as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name : undefined;
      const fieldsRaw = Array.isArray(r.fields) ? r.fields : [];
      const fields: Array<{ name: string; ty?: string }> = [];
      for (const f of fieldsRaw) {
        if (f && typeof f === "object") {
          const fr = f as Record<string, unknown>;
          const fn = fr.name;
          if (typeof fn !== "string") continue;
          const k = classifyDcFieldKind(
            fr.type ?? fr.dataType ?? fr.data_type
          );
          const ty = dcFieldKindToCompactTy(k);
          if (ty) fields.push({ name: fn, ty });
          else fields.push({ name: fn });
        }
      }
      return { name, fields };
    });
    return JSON.stringify({ metadata: compact });
  } catch {
    return rawText;
  }
}

function pickDcMetadataArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (Array.isArray(obj.metadata)) return obj.metadata;
  if (Array.isArray(obj.objects)) return obj.objects;
  if (Array.isArray(obj.items)) return obj.items;
  return null;
}

export const MCP_TOOL_SEP = TOOL_SEP;
