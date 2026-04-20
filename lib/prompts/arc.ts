// Today's Arc — structured remainder-of-workday view (UI v2 T0-3).

export const ARC_PROMPT_VERSION = "v1.1.0-2026-04-20";

export interface ArcPromptArgs {
  bankerUserId: string;
  bankerTz: string;
}

export function arcPrompt(a: ArcPromptArgs): string {
  return `Build today's arc for banker Salesforce User Id ${a.bankerUserId} (timezone ${a.bankerTz}).

SOQL — CRITICAL (invalid queries break the arc UI):
- The token NOW is NOT valid in SOQL. Never write "StartDateTime >= NOW" or "EndDateTime > NOW" — that yields MALFORMED_QUERY.
- For "today" Events use: ActivityDate = TODAY (and ORDER BY StartDateTime). Optionally also require StartDateTime >= TODAY when the field is DateTime (TODAY at midnight in the user's TZ is valid for DateTime comparisons per SOQL rules).
- For Tasks due today / overdue: ActivityDate <= TODAY with IsClosed = false and OwnerId filter.
- Prefer ONE broad Event query with ActivityDate >= TODAY ORDER BY StartDateTime, then split rows into JSON arrays by date (avoids fragile compound date literals).

TOOL PLAN — parallel where helpful:
1. salesforce_crm: Events for this user from today forward (single query — partition into nodes vs lookaheads yourself):
   SELECT Id, Subject, StartDateTime, EndDateTime, DurationInMinutes, WhoId, WhatId, What.Name
   FROM Event WHERE OwnerId = '${a.bankerUserId}' AND ActivityDate >= TODAY ORDER BY StartDateTime ASC LIMIT 100
2. salesforce_crm: Tasks for this user due today or overdue (high priority open):
   SELECT Id, Subject, Status, ActivityDate, Priority, WhoId, WhatId FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY ActivityDate ASC LIMIT 50
3. salesforce_crm: Opportunities closing soon for this user (deadlines in lookahead):
   SELECT Id, Name, CloseDate, StageName, Amount, AccountId, Account.Name FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND CloseDate >= TODAY ORDER BY CloseDate ASC LIMIT 50
4. data_360: ONLY after getDcMetadata — optional ONE SQL if a DMO clearly supports dated triggers; never guess table or column names.
5. tableau_next: optional only if you bind a real semantic model id from getSemanticModels (never use category labels like "Sales" as an id).

NODE TYPES (map each item to one):
- event — calendar meeting from Event
- deadline — task due or opportunity close
- recommended — suggested focus window from gaps
- blocked — only if evidence exists; otherwise omit

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
  "lookahead_week": [
    { "id": "...", "type": "event" | "deadline" | "recommended" | "blocked", "start": "ISO-8601", "duration_minutes": number, "title": "max 5 words", "client_id": "optional", "context": "one sentence" }
  ],
  "lookahead_month": [
    { "id": "...", "type": "event" | "deadline" | "recommended" | "blocked", "start": "ISO-8601", "duration_minutes": number, "title": "max 5 words", "client_id": "optional", "context": "one sentence" }
  ],
  "recommended_windows": [
    {
      "start": "ISO-8601",
      "duration_minutes": number,
      "suggestion": "one sentence — why this gap matters (may include Account/Contact Ids from tools)"
    }
  ]
}

Rules:
- "nodes" = only items whose start falls on TODAY between now and end_of_day (rest of workday). If none left today, nodes may be [].
- "lookahead_week" = next 7 calendar days after today through day 7 ahead (tool-backed Events/Tasks/Opportunity closes). Omit duplicates already in nodes.
- "lookahead_month" = day 8–30 ahead only.
- Sort each array by start ascending.
- If today is empty, still populate lookahead_week / lookahead_month when tools return future items, plus 1–2 recommended_windows.
- Never invent meetings — only tool-backed facts.`;
}
