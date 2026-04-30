// Salesforce-hosted MCP endpoints. These are the live URLs for Horizon.
// If Salesforce relocates them, update here only — every call site reads from this.
//
// Note on data_360 + tableau_next: we switched BOTH from the custom
// `Data360MCP` / `AnalyticsMCP` servers to the first-party
// `/platform/mcp/v1/data/data-cloud-queries` and
// `/platform/mcp/v1/analytics/tableau-next` servers on 2026-04-30. The
// first-party servers expose the same functional coverage with cleaner
// snake_case tool names (analyze_data, list_semantic_models,
// get_dc_metadata, post_dc_query_sql) and are reachable with the
// standard mcp_api + cdp_api + sfap_api scopes without per-user
// visibility filters.
export const MCP_URLS = {
  salesforce_crm:
    "https://api.salesforce.com/platform/mcp/v1/platform/sobject-all",
  data_360:
    "https://api.salesforce.com/platform/mcp/v1/data/data-cloud-queries",
  tableau_next:
    "https://api.salesforce.com/platform/mcp/v1/analytics/tableau-next",
} as const;
