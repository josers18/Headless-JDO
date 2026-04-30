// Salesforce-hosted MCP endpoints. These are the live URLs for Horizon.
// If Salesforce relocates them, update here only — every call site reads from this.
//
// Note on data_360: we switched from the custom `Data360MCP` server to the
// first-party `data/data-cloud-queries` server on 2026-04-30. The custom
// server returned "Server definition not found" despite being visible in
// Setup, while the first-party server is reachable with the standard
// cdp_api scope we already request.
export const MCP_URLS = {
  salesforce_crm:
    "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
  data_360:
    "https://api.salesforce.com/platform/mcp/v1/data/data-cloud-queries",
  tableau_next:
    "https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP",
} as const;
