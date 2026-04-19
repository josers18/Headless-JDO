import type { McpServerName } from "./horizon";

export interface McpServerConfig {
  type: "url";
  url: string;
  name: McpServerName;
  authorization_token: string;
}

export interface McpToolUseBlock {
  type: "mcp_tool_use";
  id: string;
  name: string;
  server_name: McpServerName;
  input: Record<string, unknown>;
}

export interface McpToolResultBlock {
  type: "mcp_tool_result";
  tool_use_id: string;
  is_error?: boolean;
  content: Array<{ type: "text"; text: string }>;
}

export interface TextBlock {
  type: "text";
  text: string;
}

export type ContentBlock = TextBlock | McpToolUseBlock | McpToolResultBlock;
