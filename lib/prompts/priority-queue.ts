export interface PriorityQueueArgs {
  bankerUserId: string;
  topN?: number;
}

export function priorityQueuePrompt(a: PriorityQueueArgs): string {
  const n = a.topN ?? 5;
  return `Rank the top ${n} clients banker user id ${a.bankerUserId} should touch TODAY.

Efficient plan (follow this order):
1. salesforce_crm.soqlQuery: open Opportunities assigned to this user — simple, no semi-joins with OR: SELECT Id, Name, AccountId, Account.Name, StageName, Amount, CloseDate, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY LastActivityDate ASC NULLS FIRST LIMIT 25
2. salesforce_crm.soqlQuery: overdue/due-today Tasks for this user: SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY LIMIT 25
3. salesforce_crm.soqlQuery: recent/open Cases tied to this user's accounts: SELECT Id, Subject, Status, Priority, AccountId, Account.Name FROM Case WHERE Account.OwnerId = '${a.bankerUserId}' AND IsClosed = false LIMIT 25
4. data_360 (PRESCRIPTIVE — call when ANY criterion below is met). DC differentiates a ranking from a CRM-only list: it reveals which clients have BEHAVIORAL risk that CRM's activity fields miss. Skipping when a criterion applies means under-ranking a real risk.

   CALL data_360 IF ANY OF:
   - Step 1 returned stalled opportunities (LastActivityDate > 30 days) — check for digital-engagement drops (portal/app login gap, statement opens declining) on those accounts.
   - Step 3 returned open cases with high Priority — check for external transaction anomalies on those accounts (a wire to a competitor often precedes an escalation).
   - Step 2 returned high-Priority overdue tasks on HNW accounts — check for held-away asset shifts (external movement the CRM activity log won't show).
   - The banker's book has 10+ active accounts (from step 1 coverage) — run unified engagement scoring to surface the top at-risk clients CRM alone would rank lower.

   SKIP data_360 ONLY IF: the data_360 metadata tool errors, no DMOs match any criterion, or you already have strong evidence for the top N from steps 1–3.

   EXECUTION (one pass, no retries):
   a) the data_360 metadata tool ONCE (unfiltered).
   b) Pick ONE DMO matching the triggered criterion (engagement, transactions, unified score).
   c) Verify every column verbatim in fields[] — case-sensitive, full prefix.
   d) One narrow call on the data_360 SQL tool (LIMIT 20, filter by account ids from steps 1–3 where possible).
   e) If columns don't match, skip SQL and rank from CRM only — the breaker blocks retries anyway.

5. tableau_next (REQUIRED — always attempt). Governed KPIs can change the ranking: a client with flat CRM activity but a sharp Tableau-reported portfolio-performance drop outranks one with active CRM but stable metrics. Skipping Tableau means ranking without the richest signal source.

   EXECUTION (one pass, no retries):
   a) the tableau_next models-list tool ONCE (category filter "Sales" is OK ONLY to narrow the list).
   b) Pick ONE real model identifier from a returned row — copy verbatim; NEVER use "Sales"/"Service" as the model id.
   c) One analyze call asking a concrete ranking-relevant question (e.g. clients with the largest AUM decline or win-rate drop in the banker's book).
   d) Use the answer to adjust the top-${n} ranking — a Tableau-flagged risk should promote a client upward, not introduce new ones.
   e) If the tableau_next models-list tool errors or analyze errors: do NOT retry. Rank from CRM + DC only.

Composite score (0-100): urgency (open tasks overdue, stale opps) × opportunity value (Amount) × signal strength. Pick the top ${n}.

Return JSON ONLY (no prose, no fences):
{
  "clients": [
    { "client_id": "<sf Account Id>", "name": "<Account.Name>", "reason": "one concise sentence", "score": 0-100, "sources": ["salesforce_crm"|"data_360"|"tableau_next"] }
  ]
}

Be selective — 3 high-signal entries beat 10 soft ones. Stop after 1 attempt per MCP branch if it errors or returns empty.`;
}
