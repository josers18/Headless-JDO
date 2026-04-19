export interface SignalsArgs {
  bankerUserId: string;
  windowHours?: number;
}

/**
 * Signals prompt — the Live Signal Feed. This runs on a polling cadence
 * from the client (data_360 has no push subscription, so "live" is really
 * "recent"), so the agent must be fast: one round of tool calls, no long
 * reasoning. Keep the payload compact.
 */
export function signalsPrompt(a: SignalsArgs): string {
  const days = Math.max(1, Math.round((a.windowHours ?? 24) / 24));
  return `Surface up to 6 recent high-signal events for banker user id ${a.bankerUserId}'s book. Be FAST — one pass.

Plan:
1. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, Priority, ActivityDate, CreatedDate, WhoId, Who.Name, WhatId, What.Name FROM Task WHERE OwnerId = '${a.bankerUserId}' AND CreatedDate = LAST_N_DAYS:${days} ORDER BY CreatedDate DESC LIMIT 15
2. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, Priority, AccountId, Account.Name, CreatedDate FROM Case WHERE Account.OwnerId = '${a.bankerUserId}' AND CreatedDate = LAST_N_DAYS:${days} ORDER BY CreatedDate DESC LIMIT 10
3. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, LastModifiedDate, AccountId, Account.Name FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND LastModifiedDate = LAST_N_DAYS:${days} ORDER BY LastModifiedDate DESC LIMIT 10
4. (Optional) data_360: getDcMetadata first, ONE postDcQuerySql if a relevant DMO exists. Skip on any error.

Pick up to 6 signals across the results. Bias toward severity: overdue high-priority tasks = high, new escalated cases = high, large opp stage changes = high, routine updates = low/med.

Return JSON ONLY (no prose, no fences):
{
  "signals": [
    {
      "id": "sig_<shortid>",
      "client_id": "<sf Account Id, optional>",
      "client_name": "<resolved name, optional>",
      "kind": "transaction" | "engagement" | "life_event" | "kpi" | "risk",
      "summary": "one sentence",
      "severity": "low" | "med" | "high",
      "timestamp": "<ISO 8601 from the source record>",
      "source": "data_360" | "salesforce_crm" | "tableau_next"
    }
  ]
}`;
}
