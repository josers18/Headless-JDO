export interface MorningBriefPromptArgs {
  bankerName: string;
  localTime: string;
  dayOfWeek: string;
  date: string;
  bankerUserId: string;
}

export function morningBriefPrompt(a: MorningBriefPromptArgs): string {
  const firstName = a.bankerName.split(" ")[0] ?? a.bankerName;
  return `Generate today's morning brief for ${a.bankerName}. It is ${a.localTime} on ${a.dayOfWeek}, ${a.date}.

Produce exactly 3 items that matter TODAY, ranked by importance. Each item:
- headline: one sentence ≤ 18 words
- why: one sentence of evidence
- suggested_action: one concrete next step

Efficient plan (one pass — do not retry on errors):
1. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name, Priority FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY Priority DESC LIMIT 15
2. salesforce_crm.soqlQuery: SELECT Id, Name, LastActivityDate, AnnualRevenue, Industry FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
3. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 15
4. data_360 (optional): getDcMetadata, then ONE narrow postDcQuerySql. Skip if nothing obvious.
5. tableau_next (optional): getSemanticModels then ONE analyzeSemanticData for a concrete KPI question tied to this user. Skip if not obvious.

Return structured JSON ONLY (no prose, no markdown fences):
{
  "greeting": "Good morning, ${firstName}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?" }
  ],
  "signoff": "One line, slightly personal, time-aware."
}`;
}
