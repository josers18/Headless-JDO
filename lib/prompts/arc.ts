// Today's Arc — structured remainder-of-workday view (UI v2 T0-3).

export const ARC_PROMPT_VERSION = "v1.3.1-2026-04-24";

export interface ArcPromptArgs {
  bankerUserId: string;
  bankerTz: string;
}

export function arcPrompt(a: ArcPromptArgs): string {
  return `Build today's arc for banker Salesforce User Id ${a.bankerUserId} (timezone ${a.bankerTz}).

SOQL — CRITICAL (invalid queries break the arc UI):
- The token NOW is NOT valid in SOQL. Never write "StartDateTime >= NOW" or "EndDateTime > NOW" — that yields MALFORMED_QUERY.
- **Date fields (ActivityDate, CloseDate):** use unquoted \`YYYY-MM-DD\` or \`TODAY\` / \`LAST_N_DAYS:n\` — never single-quoted dates like \`'2024-07-15'\` (INVALID_FIELD on ActivityDate).
- **Rolling windows:** \`NEXT_N_DAYS:7\`, \`LAST_N_DAYS:14\` — never \`NEXT_7_DAYS\` / \`LAST_14_DAYS\` (MALFORMED_QUERY).
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

NODE LABELING (FINAL-3 — required per node):
Every node MUST carry a "label" — the short axis caption shown under the
dot on the timeline. Labels MUST be distinct across the rest-of-today nodes
array; two nodes labeled "Focus" is a defect. Rules:
- ≤ 14 characters, Title Case.
- For "recommended" nodes (suggested focus windows), use 1–3 specific words
  drawn from the focus content: "Wellspring Prep", "Backlog Clear",
  "Chen Outreach", "Omega Close" — NEVER the generic word "Focus" repeated.
- For "event" nodes, use 1–3 words from the Subject (drop filler like
  "Call with", "Meeting re") — e.g. "Patel 1:1", "Odom Review".
- For "deadline" nodes, anchor to what is due: "Omega Close", "Odom SOW",
  "Task: Maturity".
- For "blocked" nodes, use "Blocked" or a short reason ("Travel", "OOO").
- If two candidate labels collide (two "Patel" meetings back-to-back), add
  a disambiguator: "Patel 1:1" vs "Patel prep".

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
      "label": "≤ 14 chars — distinct among same-day nodes",
      "client_id": "optional Salesforce Id",
      "context": "one sentence"
    }
  ],
  "lookahead_week": [
    { "id": "...", "type": "event" | "deadline" | "recommended" | "blocked", "start": "ISO-8601", "duration_minutes": number, "title": "max 5 words", "label": "≤ 14 chars", "client_id": "optional", "context": "one sentence" }
  ],
  "lookahead_month": [
    { "id": "...", "type": "event" | "deadline" | "recommended" | "blocked", "start": "ISO-8601", "duration_minutes": number, "title": "max 5 words", "label": "≤ 14 chars", "client_id": "optional", "context": "one sentence" }
  ],
  "recommended_windows": [
    {
      "start": "ISO-8601",
      "duration_minutes": number,
      "suggestion": "one banker-facing sentence — use client/account NAMES from the tool rows, NEVER raw Salesforce Ids"
    }
  ]
}

Rules:
- LABEL UNIQUENESS (FINAL-3): within each of nodes / lookahead_week / lookahead_month, no two entries may share the same "label". If collisions would occur, disambiguate (e.g. "Patel 1:1" + "Patel prep", or "Backlog Clear" + "Backlog QA"). Never return three nodes all labeled "Focus".
- BANKER-FACING COPY (title, context, suggestion): use human names (Account.Name, Contact names from WhoId joins). NEVER embed raw Salesforce Ids like "001am00000qvjsAAAQ" in prose. Ids belong in the structured "client_id" field only. If you do not have a resolved name, use a generic phrase ("two overdue tasks", "an at-risk opportunity").
- "nodes" = only items whose start falls on TODAY between now and end_of_day (rest of workday). If none left today, nodes may be [].
- "lookahead_week" = next 7 calendar days after today through day 7 ahead (tool-backed Events/Tasks/Opportunity closes). Omit duplicates already in nodes.
- "lookahead_month" = day 8–30 ahead only.
- Sort each array by start ascending.
- If today is empty, still populate lookahead_week / lookahead_month when tools return future items, plus 1–2 recommended_windows.
- Never invent meetings — only tool-backed facts.
- For EVERY node in nodes, lookahead_week, and lookahead_month: set "client_id" to the best primary Salesforce Id from tools (prefer Contact Id from WhoId, else Account Id from WhatId or Opportunity.AccountId, else Opportunity Id for opp deadlines). Do not leave client_id blank when the SOQL row included an Id you can copy verbatim. The UI uses client_id to resolve human names in titles.`;
}
