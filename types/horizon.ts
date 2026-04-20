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
  /** UI v2 T0-2 — index into `items` for the dominant "Right Now" hero. */
  right_now_index?: 0 | 1 | 2;
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
  client_name?: string;
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

/** UI v2 T0-1 — Pulse Strip agent JSON */
export type PulseStripTemperature = "QUIET" | "ATTENTION" | "URGENT";

export interface PulseStripNextEvent {
  time: string;
  label: string;
}

export interface PulseStripPayload {
  temperature: PulseStripTemperature;
  temperature_label: string;
  review_count: number;
  next_event: PulseStripNextEvent | null;
  flag_count: number;
  flag_deadline: "before EOD" | "this week" | "today" | null;
  strip_line: string;
}

/** UI v2 T0-3 — Today's Arc */
export type ArcNodeType = "event" | "deadline" | "recommended" | "blocked";

export interface ArcNodePayload {
  id: string;
  type: ArcNodeType;
  start: string;
  duration_minutes: number;
  title: string;
  client_id?: string;
  context: string;
}

export interface ArcRecommendedWindow {
  start: string;
  duration_minutes: number;
  suggestion: string;
}

export interface TodaysArcPayload {
  now: string;
  end_of_day: string;
  nodes: ArcNodePayload[];
  recommended_windows?: ArcRecommendedWindow[];
}
