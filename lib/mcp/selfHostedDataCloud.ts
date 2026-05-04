/**
 * Self-hosted Data 360 MCP client — Ask My Data's only data surface.
 *
 * Transport: SSE (the self-hosted server at metal-vibes-61f4a-76bf5d346a86.herokuapp.com
 * speaks MCP over legacy SSE, not Streamable HTTP). Auth: a shared
 * `x-api-key` header per turn — service-account model, not banker-scoped.
 *
 * Deliberately isolated from lib/mcp/client.ts (Today's multi-server
 * registry): single-server, single-transport, single-auth-header, no
 * Streamable fallback, no Salesforce token plumbing. This file is the
 * full scope of MCP wiring for the v1.1 Ask My Data path.
 *
 * Call shape:
 *   const session = await openSelfHostedDataCloud();
 *   try {
 *     const tools = await session.listTools();
 *     const result = await session.callTool("query_data_cloud", { query: "SELECT ..." });
 *   } finally {
 *     await session.close();
 *   }
 *
 * One session per /api/ask-data turn — MCP sessions are cheap (sub-second
 * connect) and carrying them across turns risks SSE reconnects that add
 * more complexity than they save.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export interface SelfDcToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface SelfDcCallResult {
  /** `true` when the MCP marked the response as an error. */
  isError: boolean;
  /** Raw content array from the tool response (usually `[{type:"text",text:...}]`). */
  content: unknown;
  /** Short plain-text preview for the reasoning trail (≤ 2KB). */
  textPreview: string;
  /** Full-size payload the agent reads as tool_result content. */
  modelText: string;
}

export interface SelfDcSession {
  listTools(): Promise<SelfDcToolDef[]>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<SelfDcCallResult>;
  close(): Promise<void>;
}

const SERVER_URL_DEFAULT =
  "https://metal-vibes-61f4a-76bf5d346a86.herokuapp.com/sse";

// Per-tool timeouts. Matches the discipline from lib/mcp/client.ts —
// SQL queries can be slow (synchronous Data Cloud SQL), metadata calls
// are typically quick but the MCP proxies SF so we leave headroom.
const TIMEOUT_SCHEMA_MS = 15_000;
const TIMEOUT_SQL_MS = 20_000;
const TIMEOUT_DEFAULT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 8_000;

function timeoutForTool(name: string): number {
  if (/^(query_data_cloud|query_async|get_async_query_results)$/i.test(name))
    return TIMEOUT_SQL_MS;
  if (
    /^(get_data_lake_objects|describe_data_lake_object|list_.*|get_calculated_insights)$/i.test(
      name
    )
  )
    return TIMEOUT_SCHEMA_MS;
  return TIMEOUT_DEFAULT_MS;
}

function requiredApiKey(): string {
  const key = process.env.SELF_DATA360_MCP_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "SELF_DATA360_MCP_API_KEY is not set. " +
        "Ask My Data cannot reach the self-hosted Data 360 MCP. " +
        "Set it in .env (see .env.example)."
    );
  }
  return key;
}

function serverUrl(): string {
  return process.env.SELF_DATA360_MCP_URL?.trim() || SERVER_URL_DEFAULT;
}

/**
 * Opens an MCP session to the self-hosted Data 360 server. Throws with
 * a banker-safe message if env is misconfigured or connect exceeds
 * {@link CONNECT_TIMEOUT_MS}.
 */
export async function openSelfHostedDataCloud(options?: {
  signal?: AbortSignal;
}): Promise<SelfDcSession> {
  const apiKey = requiredApiKey();
  const authHeaders = { "x-api-key": apiKey };

  const transport = new SSEClientTransport(new URL(serverUrl()), {
    requestInit: {
      headers: authHeaders,
      signal: options?.signal,
    },
    eventSourceInit: {
      // The SSE GET needs the same header. SDK intercepts fetch, but
      // passing an explicit wrapper ensures the handshake is authed.
      fetch: (u, init) =>
        fetch(u, {
          ...init,
          headers: { ...(init?.headers ?? {}), ...authHeaders },
        }),
    },
  });

  const client = new Client(
    { name: "horizon-ask-data", version: "0.1.0" },
    { capabilities: {} }
  );

  // Wrap connect in an explicit timeout — a stuck SSE handshake
  // otherwise eats the whole /api/ask-data request.
  const connectCtl = new AbortController();
  const connectTimer = setTimeout(
    () => connectCtl.abort(),
    CONNECT_TIMEOUT_MS
  );
  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) =>
        connectCtl.signal.addEventListener("abort", () =>
          reject(
            new Error(
              `self-hosted DC MCP connect timed out after ${CONNECT_TIMEOUT_MS}ms`
            )
          )
        )
      ),
    ]);
  } finally {
    clearTimeout(connectTimer);
  }

  return {
    async listTools(): Promise<SelfDcToolDef[]> {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? undefined,
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
          type: "object",
          properties: {},
        },
      }));
    },

    async callTool(
      name: string,
      args: Record<string, unknown>
    ): Promise<SelfDcCallResult> {
      const controller = new AbortController();
      const timeout = timeoutForTool(name);
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const raw = await client.callTool(
          { name, arguments: args },
          undefined,
          { timeout, signal: controller.signal }
        );
        const isError = Boolean(raw.isError);
        const modelText = extractText(raw.content).slice(0, 8_000);
        const textPreview = modelText.slice(0, 2_000);
        return {
          isError,
          content: raw.content,
          modelText,
          textPreview,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          modelText: `[self-hosted MCP error: ${message}]`,
          textPreview: `Error: ${message}`,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async close(): Promise<void> {
      try {
        await client.close();
      } catch {
        /* already closed / network torn down — not worth surfacing */
      }
    },
  };
}

/**
 * Flatten an MCP tool response's `content` array into a single plain-text
 * string. MCP content chunks are `{type:"text",text:"..."}` in practice
 * for the self-hosted server; other types get serialized as JSON so the
 * model can still read them.
 */
function extractText(content: unknown): string {
  if (!Array.isArray(content)) return JSON.stringify(content ?? "");
  const parts: string[] = [];
  for (const chunk of content as Array<Record<string, unknown>>) {
    if (chunk && chunk.type === "text" && typeof chunk.text === "string") {
      parts.push(chunk.text);
    } else {
      parts.push(JSON.stringify(chunk));
    }
  }
  return parts.join("\n");
}
