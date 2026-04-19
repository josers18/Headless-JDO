export type McpServerName =
  | "salesforce_crm"
  | "data_360"
  | "tableau_next"
  | "heroku_toolkit";

export interface BriefItem {
  headline: string;
  why: string;
  suggested_action: string;
  sources: McpServerName[];
  client_id?: string;
}

export interface MorningBrief {
  greeting: string;
  items: BriefItem[];
  signoff: string;
}

export interface PriorityClient {
  client_id: string;
  name: string;
  reason: string;
  score: number;
  sources: McpServerName[];
}

export interface DraftAction {
  id: string;
  kind: "task" | "email" | "update" | "call";
  title: string;
  body: string;
  target_object: "Account" | "Contact" | "Opportunity" | "Task" | "Case";
  target_id: string;
  confidence: number;
}

export interface Signal {
  id: string;
  client_id?: string;
  kind: "transaction" | "engagement" | "life_event" | "kpi" | "risk";
  summary: string;
  severity: "low" | "med" | "high";
  timestamp: string;
  source: McpServerName;
}

export interface ReasoningStep {
  server: McpServerName | "llm";
  tool?: string;
  input?: unknown;
  output_preview?: string;
  ms?: number;
}
