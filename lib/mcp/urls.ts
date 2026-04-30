// Salesforce-hosted MCP endpoints. These are the live URLs for Horizon.
// If Salesforce relocates them, update here only — every call site reads from this.
export const MCP_URLS = {
  salesforce_crm:
    "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
  data_360: "https://api.salesforce.com/platform/mcp/v1/custom/Data360MCP",
  tableau_next:
    "https://api.salesforce.com/platform/mcp/v1/custom/AnalyticsMCP",
} as const;
