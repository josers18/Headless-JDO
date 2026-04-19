import Anthropic from "@anthropic-ai/sdk";
import { buildMcpServers } from "./mcp-servers";
import { requireEnv } from "@/lib/utils";

// Anthropic MCP beta header. If the MCP client API graduates or the header
// string changes, update here — this is the single source of truth.
// Current as of 2026-04; the 2025-04-04 header is deprecated.
const ANTHROPIC_MCP_BETA = "mcp-client-2025-11-20";

// Claude Sonnet 4 is the spec-locked model for Horizon. Do not swap providers
// or models without updating CLAUDE.md Section 2.
export const HORIZON_MODEL = "claude-sonnet-4-20250514";

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (_client) return _client;
  _client = new Anthropic({
    apiKey: requireEnv("ANTHROPIC_API_KEY"),
    defaultHeaders: { "anthropic-beta": ANTHROPIC_MCP_BETA },
  });
  return _client;
}

export interface AskArgs {
  messages: Anthropic.MessageParam[];
  system: string;
  salesforceToken: string;
  maxTokens?: number;
  temperature?: number;
}

export async function ask({
  messages,
  system,
  salesforceToken,
  maxTokens = 4096,
  temperature = 0.3,
}: AskArgs) {
  // why: `mcp_servers` is still behind a beta header; cast keeps TS happy
  // until the SDK adds first-class typings for it.
  return client().messages.create({
    model: HORIZON_MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages,
    // @ts-expect-error - beta parameter not yet in SDK typings
    mcp_servers: buildMcpServers(salesforceToken),
  });
}

export async function askStream({
  messages,
  system,
  salesforceToken,
  maxTokens = 4096,
  temperature = 0.3,
}: AskArgs) {
  return client().messages.stream({
    model: HORIZON_MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages,
    // @ts-expect-error - beta parameter not yet in SDK typings
    mcp_servers: buildMcpServers(salesforceToken),
  });
}
