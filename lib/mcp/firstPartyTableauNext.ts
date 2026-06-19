/**
 * Analyze's MCP client: Salesforce-hosted Tableau Next
 * (`/platform/mcp/v1/analytics/tableau-next`).
 *
 * Mirrors lib/mcp/firstPartyDataCloud.ts: single-server, single-transport,
 * banker-scoped bearer auth via the PKCE access token from ensureFreshToken.
 * One session per request — cheap to open (~700ms connect) and keeps state
 * local to each turn.
 *
 * Curated tool subset is enforced at the agent layer (see
 * lib/inference/analyzeAgent.ts), not here — this module just exposes the
 * raw MCP surface.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_URLS } from "@/lib/mcp/urls";

export interface TableauNextToolDef {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface TableauNextCallResult {
  isError: boolean;
  content: unknown;
  /** ≤ 2KB preview for the reasoning trail. */
  textPreview: string;
  /** Up to 8KB payload for the model's tool_result context. */
  modelText: string;
}

export interface TableauNextSession {
  listTools(): Promise<TableauNextToolDef[]>;
  callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<TableauNextCallResult>;
  close(): Promise<void>;
}

// Per-tool timeouts. `analyze_data` can take 30–60s on complex questions
// (Concierge goes through Analytics Agent's reasoning); everything else
// is metadata and should be fast.
const TIMEOUT_ANALYZE_MS = 45_000;
const TIMEOUT_METADATA_MS = 15_000;
const TIMEOUT_DEFAULT_MS = 12_000;
const CONNECT_TIMEOUT_MS = 10_000;

function timeoutForTool(name: string): number {
  if (/^analyze_data$/i.test(name)) return TIMEOUT_ANALYZE_MS;
  if (/^(list_|get_)/i.test(name)) return TIMEOUT_METADATA_MS;
  return TIMEOUT_DEFAULT_MS;
}

export async function openFirstPartyTableauNext(options: {
  salesforceToken: string;
  signal?: AbortSignal;
}): Promise<TableauNextSession> {
  if (!options.salesforceToken) {
    throw new Error(
      "openFirstPartyTableauNext: salesforceToken is required."
    );
  }

  const authHeaders = { Authorization: `Bearer ${options.salesforceToken}` };

  const transport = new StreamableHTTPClientTransport(
    new URL(MCP_URLS.tableau_next),
    { requestInit: { headers: authHeaders, signal: options.signal } }
  );

  const client = new Client(
    { name: "horizon-analyze", version: "0.1.0" },
    { capabilities: {} }
  );

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
              `Tableau Next MCP connect timed out after ${CONNECT_TIMEOUT_MS}ms`
            )
          )
        )
      ),
    ]);
  } finally {
    clearTimeout(connectTimer);
  }

  return {
    async listTools(): Promise<TableauNextToolDef[]> {
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
    ): Promise<TableauNextCallResult> {
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
        // why: analyze_data wraps a small `answer` + structured data in a
        // payload alongside a large `troubleshootingInfo` blob (IR spec,
        // raw SQL, full row dump) that nothing downstream reads. On a
        // 41-month series that blob pushes the JSON well past 8KB, so the
        // blind slice below used to cut mid-`troubleshootingInfo` —
        // corrupting the JSON so `extractAnalyzeAnswer`/`extractTableFallback`
        // (both do a whole-string JSON.parse) threw and returned null →
        // no dominant answer → no table, no chart, only the model's prose.
        // Strip the blob BEFORE the cap so the answer + data survive intact
        // (and the model's tool_result context stays lean). See charts bug,
        // 2026-06-19.
        const modelText = slimAnalyzePayload(extractText(raw.content)).slice(
          0,
          8_000
        );
        const textPreview = modelText.slice(0, 2_000);
        return { isError, content: raw.content, modelText, textPreview };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text", text: message }],
          modelText: `[Tableau Next MCP error: ${message}]`,
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
        /* already closed */
      }
    },
  };
}

/**
 * analyze_data responses carry a `troubleshootingInfo` object (IR spec,
 * raw SQL query, and a full row dump) that no downstream consumer reads —
 * it's pure debug noise. On large result sets it dominates the payload
 * and, once the whole thing exceeds the 8KB model-context cap, a blind
 * string slice corrupts the surrounding JSON (the `answer` + structured
 * data live near the front, the blob near the back). Drop the blob while
 * the JSON is still well-formed so the cap only ever trims content nobody
 * needs. Best-effort: if the text isn't the expected JSON object, return
 * it untouched — the cap still applies.
 */
function slimAnalyzePayload(text: string): string {
  if (!text || !text.includes("troubleshootingInfo")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return text;
  }
  const obj = parsed as Record<string, unknown>;
  if (!("troubleshootingInfo" in obj)) return text;
  delete obj.troubleshootingInfo;
  return JSON.stringify(obj);
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
