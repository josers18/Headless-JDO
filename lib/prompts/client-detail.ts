export interface ClientDetailArgs {
  clientId: string;
  clientName?: string;
  bankerUserId: string;
}

/**
 * Client Detail prompt — a streaming 360° view triggered by clicking a row
 * in the Priority Queue. We deliberately lean on all three Salesforce MCPs
 * so the banker sees a coherent picture: the business record, behavioral
 * signals, and the KPI context in one glance.
 */
export function clientDetailPrompt(a: ClientDetailArgs): string {
  const nameHint = a.clientName
    ? ` The client's display name is "${a.clientName}".`
    : "";
  return `Produce a 360° snapshot of Account ${a.clientId} for banker user id ${a.bankerUserId}.${nameHint}

Plan — one pass, no retries on errors, use getObjectSchema before any custom field (__c):
1. salesforce_crm.soqlQuery: SELECT Id, Name, Industry, AnnualRevenue, Type, LastActivityDate, OwnerId FROM Account WHERE Id = '${a.clientId}' LIMIT 1
2. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, CloseDate, Probability, LastActivityDate FROM Opportunity WHERE AccountId = '${a.clientId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 10
3. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, ActivityDate, Priority, WhoId, Who.Name FROM Task WHERE AccountId = '${a.clientId}' AND CreatedDate = LAST_N_DAYS:60 ORDER BY ActivityDate DESC NULLS LAST LIMIT 10
4. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, Priority, CreatedDate FROM Case WHERE AccountId = '${a.clientId}' AND IsClosed = false ORDER BY CreatedDate DESC LIMIT 10
5. (Optional) data_360: getDcMetadata to find a Profile or Engagement DMO; if one exists, ONE postDcQuerySql WHERE a client identifier matches '${a.clientId}'. Skip on errors — do not guess.
6. (Optional) tableau_next: getSemanticModels, then ONE analyzeSemanticData concrete question scoped to this account. Skip on errors.

Return JSON ONLY (no prose, no fences):
{
  "client_id": "${a.clientId}",
  "name": "<resolved name>",
  "summary": "<= 2 sentences, lead with the insight",
  "profile": {
    "segment": "<string or null>",
    "relationship_since": "<yyyy-mm-dd or null>",
    "total_aum": "<string or null>"
  },
  "opportunities": [ { "id": "...", "name": "...", "stage": "...", "amount": "...", "close_date": "..." } ],
  "tasks": [ { "id": "...", "subject": "...", "status": "...", "due_date": "..." } ],
  "cases": [ { "id": "...", "subject": "...", "status": "...", "priority": "..." } ],
  "signals": [ { "kind": "transaction"|"engagement"|"life_event"|"risk"|"kpi", "summary": "...", "severity": "low"|"med"|"high", "source": "data_360"|"tableau_next"|"salesforce_crm" } ],
  "kpis": [ { "label": "...", "value": "...", "delta": "...", "direction": "up"|"down"|"flat" } ],
  "recommended_actions": [ { "kind": "task"|"email"|"update"|"call", "title": "...", "rationale": "..." } ]
}

Keep arrays short (≤ 5 entries each). If a data source returns nothing, emit an empty array for that field — do not fabricate.`;
}
