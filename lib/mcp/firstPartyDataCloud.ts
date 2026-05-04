/**
 * Ask My Data's MCP client: Salesforce-hosted Data 360 (data-cloud-queries).
 *
 * Replaces lib/mcp/selfHostedDataCloud.ts after the self-hosted OAuth
 * path proved unreliable in demo (see docs/ASK_MY_DATA_T1_VALIDATION.md).
 * The first-party server has only 2 tools — `get_dc_metadata` and
 * `post_dc_query_sql` — but those cover the three must-haves (list DLOs,
 * inspect schema, run SQL) and authenticate with the banker's existing
 * Salesforce PKCE token, so row-level security reflects the banker.
 *
 * Isolated from lib/mcp/client.ts (Today's multi-server registry):
 * single-server, single-transport, single-auth-mode. One session per
 * /api/ask-data turn (cheap: sub-second connect).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_URLS } from "@/lib/mcp/urls";

export interface FirstPartyDcToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface FirstPartyDcCallResult {
  isError: boolean;
  content: unknown;
  /** ≤ 2KB preview for the banker-facing reasoning trail. */
  textPreview: string;
  /** Larger payload the agent loop feeds to the model as tool_result content. */
  modelText: string;
}

export interface FirstPartyDcSession {
  listTools(): Promise<FirstPartyDcToolDef[]>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<FirstPartyDcCallResult>;
  close(): Promise<void>;
}

// Per-tool timeouts. `post_dc_query_sql` can run real SQL against Data
// Cloud — allow up to 25s which is well under Heroku's H12 30s budget.
// Metadata calls are quick; defaults keep them snappy so a stuck
// metadata fetch doesn't eat the turn.
const TIMEOUT_SQL_MS = 25_000;
const TIMEOUT_METADATA_MS = 15_000;
const TIMEOUT_DEFAULT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 8_000;

function timeoutForTool(name: string): number {
  if (/^(post_dc_query_sql|postDcQuerySql)/i.test(name)) return TIMEOUT_SQL_MS;
  if (/^(get_dc_metadata|getDcMetadata)/i.test(name)) return TIMEOUT_METADATA_MS;
  return TIMEOUT_DEFAULT_MS;
}

/**
 * Opens an MCP session to the first-party data-cloud-queries server
 * using the banker's Salesforce access token. Caller is responsible
 * for `close()`.
 */
export async function openFirstPartyDataCloud(options: {
  salesforceToken: string;
  signal?: AbortSignal;
}): Promise<FirstPartyDcSession> {
  if (!options.salesforceToken) {
    throw new Error(
      "openFirstPartyDataCloud: salesforceToken is required. " +
        "Ensure ensureFreshToken() returned a live token before calling."
    );
  }

  const authHeaders = { Authorization: `Bearer ${options.salesforceToken}` };

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URLS.data_360), {
    requestInit: { headers: authHeaders, signal: options.signal },
  });

  const client = new Client(
    { name: "horizon-ask-data", version: "0.1.0" },
    { capabilities: {} }
  );

  // Connect with an explicit timeout — a stuck handshake otherwise eats
  // the whole /api/ask-data request.
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
              `first-party DC MCP connect timed out after ${CONNECT_TIMEOUT_MS}ms`
            )
          )
        )
      ),
    ]);
  } finally {
    clearTimeout(connectTimer);
  }

  return {
    async listTools(): Promise<FirstPartyDcToolDef[]> {
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
    ): Promise<FirstPartyDcCallResult> {
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
        return { isError, content: raw.content, modelText, textPreview };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          modelText: `[first-party Data 360 MCP error: ${message}]`,
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
        /* already closed — not worth surfacing */
      }
    },
  };
}

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
