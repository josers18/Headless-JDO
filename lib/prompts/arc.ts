// Today's Arc — structured remainder-of-workday view (UI v2 T0-3).

export const ARC_PROMPT_VERSION = "v1.0.0-2026-04-20";

export interface ArcPromptArgs {
  bankerUserId: string;
  bankerTz: string;
}

export function arcPrompt(a: ArcPromptArgs): string {
  return `Build today's arc for banker Salesforce User Id ${a.bankerUserId} (timezone ${a.bankerTz}).

TOOL PLAN — parallel where helpful:
1. salesforce_crm: Events owned by this user where ActivityDate = TODAY and StartDateTime >= NOW (in org time). Include Subject, StartDateTime, DurationInMinutes, Who/What when present.
2. salesforce_crm: Tasks owned by this user where (ActivityDate = TODAY OR (IsHighPriority = true AND IsClosed = false AND ActivityDate <= TODAY))) — Subject, ActivityDate, Priority.
3. data_360: ONLY after getDcMetadata — optional ONE SQL for dated triggers today (maturities, scheduled actions) if a DMO supports it; never guess column names.
4. tableau_next: optional market close note only if you can bind a real semantic model id from getSemanticModels (never use "Sales" as model id).

NODE TYPES (map each item to one):
- event — calendar meeting from Event
- deadline — task due or opportunity close today
- recommended — agent-suggested focus window from gaps in the calendar (infer from empty spans)
- blocked — focus / DND only if evidence in data; otherwise omit

Return JSON ONLY (no fences, no prose):
{
  "now": "ISO-8601 with offset for banker wall clock",
  "end_of_day": "ISO-8601 same day (typically 18:00 local or bank policy)",
  "nodes": [
    {
      "id": "stable string id",
      "type": "event" | "deadline" | "recommended" | "blocked",
      "start": "ISO-8601",
      "duration_minutes": number,
      "title": "max 5 words",
      "client_id": "optional Salesforce Id",
      "context": "one sentence"
    }
  ],
  "recommended_windows": [
    {
      "start": "ISO-8601",
      "duration_minutes": number,
      "suggestion": "one sentence — why this gap matters"
    }
  ]
}

Sort nodes by start ascending. If the afternoon is empty, return nodes: [] and recommended_windows with 1–2 helpful suggestions. Never invent meetings — only tool-backed facts.`;
}
