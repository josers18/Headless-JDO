import type { McpServerConfig } from "@/types/mcp";

// Salesforce-hosted MCP endpoints. These are the live URLs for Horizon.
// If Salesforce relocates them, update here only — every call site reads from this.
export const MCP_URLS = {
  salesforce_crm:
    "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
  data_360: "https://api.salesforce.com/platform/mcp/v1/custom/Data360MCP",
  tableau_next:
    "https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP",
} as const;

// Heroku Inference MCP Toolkit — the unified SSE endpoint that exposes any
// custom MCP servers registered to the heroku-inference add-on on this app.
// Derived from INFERENCE_URL + INFERENCE_KEY (set automatically by the
// heroku-inference addon). Falls back silently if the env vars aren't set
// (e.g. local dev without an inference license).
function herokuToolkitServer(): McpServerConfig | null {
  const base = process.env.INFERENCE_URL;
  const token = process.env.INFERENCE_KEY;
  if (!base || !token) return null;
  return {
    type: "url",
    url: `${base.replace(/\/$/, "")}/mcp/sse`,
    name: "heroku_toolkit",
    authorization_token: token,
  };
}

export function buildMcpServers(salesforceToken: string): McpServerConfig[] {
  const servers: McpServerConfig[] = [
    {
      type: "url",
      url: MCP_URLS.salesforce_crm,
      name: "salesforce_crm",
      authorization_token: salesforceToken,
    },
    {
      type: "url",
      url: MCP_URLS.data_360,
      name: "data_360",
      authorization_token: salesforceToken,
    },
    {
      type: "url",
      url: MCP_URLS.tableau_next,
      name: "tableau_next",
      authorization_token: salesforceToken,
    },
  ];
  const heroku = herokuToolkitServer();
  if (heroku) servers.push(heroku);
  return servers;
}
