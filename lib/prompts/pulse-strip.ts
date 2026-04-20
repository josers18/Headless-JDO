// Pulse Strip — single-line flight-deck read (UI v2 T0-1).
// Contract: JSON only; multi-MCP in parallel; under 12 words in strip_line.

export const PULSE_STRIP_PROMPT_VERSION = "v1.0.0-2026-04-20";

export interface PulseStripPromptArgs {
  bankerUserId: string;
  bankerTz: string;
}

export function pulseStripPrompt(a: PulseStripPromptArgs): string {
  return `You are generating the Pulse Strip — a single-line flight-deck temperature read for a relationship banker. They must understand state in under 1 second.

BANKER (pre-resolved — do NOT call salesforce_crm.getUserInfo just to resolve this):
  Salesforce User Id: ${a.bankerUserId}
  Wall-clock timezone for "today" and EOD: ${a.bankerTz}

TOOL PLAN — call MCP tools in parallel when the question spans sources:
1. salesforce_crm: Today's calendar and workload for this owner only.
   - Tasks: ActivityDate = TODAY or overdue, Priority = High when relevant, Status != Completed
   - Events: ActivityDate = TODAY, StartDateTime >= NOW() in org TZ (use the banker's day)
   - Opportunities: IsClosed = false, OwnerId = banker, CloseDate = TODAY or NEXT 7 DAYS if they imply same-day urgency
2. data_360: ONLY after getDcMetadata — one tight postDcQuerySql if a DMO clearly supports same-day signals (anomalies, maturities). Never guess column names; copy from metadata. If nothing fits, skip data_360 honestly.
3. tableau_next: Optional. getSemanticModels to narrow, then bind analyzeSemanticData to a real model id from a row — never use "Sales" or "Service" as the model id. One metric only if it signals intraday or before-EOD risk; otherwise skip.

TEMPERATURE — pick exactly one:
- QUIET — no time-sensitive work in the next few hours; nothing URGENT below.
- ATTENTION — one or two time-sensitive items OR a notable pattern; nothing requiring action within 4 hours that is material/compliance-critical.
- URGENT — something should happen within 4 hours OR tool results show a material anomaly / time-bound risk for this banker today.

OUTPUT — return a single JSON object ONLY (no markdown fence, no prose before or after):
{
  "temperature": "QUIET" | "ATTENTION" | "URGENT",
  "temperature_label": "string, ≤ 3 words after the mood (e.g. QUIET MONDAY, ATTENTION, URGENT)",
  "review_count": number,
  "next_event": { "time": "3:30 PM", "label": "Patel" } | null,
  "flag_count": number,
  "flag_deadline": "before EOD" | "this week" | "today" | null,
  "strip_line": "string — the entire one-line strip for the UI, MAXIMUM 12 words (not counting a single leading emoji if you include one). Reads like Linear's status bar, not a paragraph."
}

strip_line should feel like: temperature copy · item count · next event · flags (when relevant). If next_event is null, omit that segment cleanly. If flag_count is 0, say so briefly ("0 flags"). Never invent client names, times, or Ids — only facts from tool results. If tools are empty, set temperature QUIET, review_count 0, next_event null, flag_count 0, strip_line honest and short.`;
}
