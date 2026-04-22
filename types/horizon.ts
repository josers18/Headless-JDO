export type McpServerName =
  | "salesforce_crm"
  | "data_360"
  | "tableau_next"
  | "heroku_toolkit";

export interface BriefEntityLink {
  client_id: string;
  client_name?: string;
}

export interface BriefItem {
  headline: string;
  why: string;
  suggested_action: string;
  sources: McpServerName[];
  client_id?: string;
  /** Human label for `client_id` (Account/Contact/etc.); used for name links in the UI. */
  client_name?: string;
  /** Other Accounts/Contacts named in this item (multi-account copy). */
  entity_links?: BriefEntityLink[];
  /**
   * FINAL-1 — short, specific imperative verb phrase ("Call",
   * "Update stage", "Mark closed-lost", "Book 20m", "Draft outreach",
   * "Schedule") extracted from `suggested_action`. Required on the
   * item referenced by `right_now_index`; optional on others. Used
   * as the Right Now primary button label. Must be ≤ 14 characters.
   */
  right_now_cta?: string;
}

/** P1-1 — housekeeping tasks (>14 days overdue); shown in collapsed UI only. */
export interface OlderBacklogSummary {
  /** Number of open tasks overdue more than 14 days (from CRM task query). */
  task_count: number;
  /** One readable line — themes only, no day-count lecturing (≤ 140 chars). */
  summary: string;
}

/** FinServ Life Event rows surfaced in the morning brief (CRM-backed). */
export interface BriefLifeEventRow {
  client_id: string;
  client_name: string;
  event_type: string;
  /** ISO date (YYYY-MM-DD) or locale-neutral display from CRM. */
  event_date: string;
  /** One line for the UI list (≤ 120 chars). */
  summary: string;
}

export interface MorningBrief {
  greeting: string;
  items: BriefItem[];
  signoff: string;
  /** UI v2 T0-2 — index into `items` for the dominant "Right Now" hero. */
  right_now_index?: 0 | 1 | 2;
  /**
   * FIX_PASS P1-1 — older open tasks (>14 days overdue). Omit when zero or
   * when task data was unavailable.
   */
  older_backlog?: OlderBacklogSummary | null;
  /**
   * Recent / horizon life events from CRM (PersonLifeEvent and/or FinServ__LifeEvent__c).
   * Omit or empty when none qualify.
   */
  recent_life_events?: BriefLifeEventRow[];
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
  /**
   * FINAL-3 — short distinct axis caption (≤ 14 chars, Title Case).
   * Must be unique within a given nodes/lookahead array. The arc
   * prompt now requires it; older cached payloads may omit it, in
   * which case the client falls back to a type-derived label.
   */
  label?: string;
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
  /** Upcoming items (typically next ~7 days after today), same shape as nodes. */
  lookahead_week?: ArcNodePayload[];
  /** Further horizon (e.g. days 8–30), same shape as nodes. */
  lookahead_month?: ArcNodePayload[];
  recommended_windows?: ArcRecommendedWindow[];
}
