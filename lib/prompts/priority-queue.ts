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
4. data_360 (optional, best-effort): Call getDcMetadata first. Run postDcQuerySql ONLY using table and column API names that appear VERBATIM in that metadata response. NEVER invent or assume DMO names (e.g. do not query EngagementChannelAction__dll or any *.__dll table unless that exact identifier appears in metadata). If no clearly relevant DMO exists for this org, skip data_360 entirely — do not retry with guessed tables or copied training-data names.
5. tableau_next (optional): getSemanticModels first (category filter like "Sales" is OK ONLY to narrow the list). Then at most ONE analyzeSemanticData — you MUST set targetEntityIdOrApiName (or the tool's equivalent field) to an id/apiName copied verbatim from ONE row in that getSemanticModels response. NEVER use "Sales", "Service", or any category label as the model identifier (that causes INVALID_INPUT). If the list is empty or you cannot bind a row, skip analyze entirely.

Composite score (0-100): urgency (open tasks overdue, stale opps) × opportunity value (Amount) × signal strength. Pick the top ${n}.

Return JSON ONLY (no prose, no fences):
{
  "clients": [
    { "client_id": "<sf Account Id>", "name": "<Account.Name>", "reason": "one concise sentence", "score": 0-100, "sources": ["salesforce_crm"|"data_360"|"tableau_next"] }
  ]
}

Be selective — 3 high-signal entries beat 10 soft ones. Stop after 1 attempt per MCP branch if it errors or returns empty.`;
}
