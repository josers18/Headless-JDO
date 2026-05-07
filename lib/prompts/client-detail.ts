export interface ClientDetailArgs {
  clientId: string;
  clientName?: string;
  bankerUserId: string;
}

function sq(s: string): string {
  return s.replace(/'/g, "''");
}

function isLikelySalesforceUserId(id: string): boolean {
  const clean = id.replace(/[^0-9a-zA-Z]/g, "");
  if (clean.length !== 15 && clean.length !== 18) return false;
  return clean.slice(0, 3) === "005";
}

/**
 * Client Detail prompt — a streaming 360° view triggered by clicking a row
 * in the Priority Queue. We deliberately lean on all three Salesforce MCPs
 * so the banker sees a coherent picture: the business record, behavioral
 * signals, and the KPI context in one glance.
 */
export function clientDetailPrompt(a: ClientDetailArgs): string {
  const cid = sq(a.clientId.trim());
  const bid = sq(a.bankerUserId.trim());
  const nameHint = a.clientName
    ? ` The client's display name is "${a.clientName}".`
    : "";
  const bankerStep = isLikelySalesforceUserId(a.bankerUserId)
    ? `0. salesforce_crm.soqlQuery: SELECT Id, Name FROM User WHERE Id = '${bid}' LIMIT 1`
    : "0. (Skip banker User lookup — no valid User Id.)";
  return `Produce a 360° snapshot of Account '${cid}' for the authenticated banker.${nameHint}
Use this User Id only inside SOQL filters, never in human-readable JSON fields: '${bid}'.

Plan — emit ALL tool_calls below IN PARALLEL on iteration 1, then synthesize the JSON. Do NOT add follow-up tool calls; do NOT retry on errors. The browser caches successful sheets per session, so first open is paid once and reopens are instant — depth on first open matters.

${bankerStep}
1. salesforce_crm.soqlQuery: SELECT Id, Name, Industry, AnnualRevenue, Type, LastActivityDate, OwnerId, Owner.Name FROM Account WHERE Id = '${cid}' LIMIT 1
2. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, CloseDate, Probability, LastActivityDate FROM Opportunity WHERE AccountId = '${cid}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 5
3. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, ActivityDate, Priority, WhoId, Who.Name FROM Task WHERE AccountId = '${cid}' AND CreatedDate = LAST_N_DAYS:60 ORDER BY ActivityDate DESC NULLS LAST LIMIT 5
4. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, Priority, CreatedDate FROM Case WHERE AccountId = '${cid}' AND IsClosed = false ORDER BY CreatedDate DESC LIMIT 5
5. data_360 — emit this SQL VERBATIM: SELECT "amount__c", "transactiondate__c", "transaction_type__c", "description__c" FROM "Financial_Transactions_Snow_XL__dll" WHERE "transactiondate__c" >= TIMESTAMP '2024-06-01 00:00:00 UTC' ORDER BY "amount__c" DESC LIMIT 5. The DC \`accountid__c\` namespace is decoupled from Salesforce \`Account.Id\` in this org, so a CRM-id WHERE clause returns zero. Pull the top recent transactions across the demo data window — use them to seed 1–2 entries in "signals" with kind: "transaction" and a short summary like "$2,799 charge in <description> on <date>".
6. tableau_next — emit this analyze_data call VERBATIM: targetEntityType: "sdm", targetEntityIdOrApiName: "Financial_Accounts", question: "Total Current_Balance across Deposits". This SDM and measure are verified against the cached catalog. Use the response to populate one entry in "kpis" with label: "Deposits balance" and the analyze response's top number as the value.

If steps 5 or 6 error or time out: skip them — leave "signals" and "kpis" with whatever you got from the other steps (or empty arrays). Do NOT retry.

Return JSON ONLY (no prose, no fences):
{
  "client_id": "${a.clientId}",
  "name": "<resolved name>",
  "summary": "<= 2 sentences, lead with the insight; use Owner.Name from step 1 for the relationship owner and the banker's Name from step 0 when you mention them — never paste raw User Ids (005…) in summary text",
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
