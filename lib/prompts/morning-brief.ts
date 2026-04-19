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

TOOL SELECTION — STRICT RULES
For ANY morning brief, you MUST call at least TWO different MCP servers.
A brief that only uses salesforce_crm is incomplete and will be rejected.

Category mapping (use this to decide which server fits which item):
  - "Who is this client / what tasks are due / what opportunities exist"
      → salesforce_crm (structured CRM records)
  - "Transactional anomalies / held-away shifts / digital-engagement drops / life events"
      → data_360 (unified data via SQL)
  - "Pipeline metrics / win rate / AUM trends / portfolio performance / KPI breaches"
      → tableau_next (governed semantic models via analyze_data)

Before producing the final JSON, verify that your 3 items collectively exercise at
least two of the three servers. If only one was useful, EXPAND your queries to
the others before giving up. Prefer concrete Tableau Next questions tied to this
user's book of business (e.g. "What was ${a.bankerName}'s total pipeline change
over the last 7 days?") over vague analytical asks.

Produce exactly 3 items that matter TODAY, ranked by importance. Each item:
- headline: one sentence ≤ 18 words
- why: one sentence of evidence
- suggested_action: one concrete next step

Efficient plan (one pass — do not retry on errors):
1. salesforce_crm (structured records): SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name, Priority FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY Priority DESC LIMIT 15
2. salesforce_crm (structured records): SELECT Id, Name, LastActivityDate, AnnualRevenue, Industry FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
3. salesforce_crm (structured records): SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 15
4. tableau_next (REQUIRED — must attempt): call the semantic-models list tool (name starts with "getSemanticModels") filtered by a Sales or Service category, then call the analytics Q&A tool (name starts with "analyze") ONCE with a concrete metric question tied to this banker ("what is the pipeline change for OwnerId = ${a.bankerUserId} over the last 7 days?"). Use the result to generate ONE of your 3 items (a KPI-driven signal).
5. data_360 (REQUIRED — must attempt): call the Data Cloud metadata tool (name starts with "getDcMetadata") to discover available DLOs/DMOs, then if an obviously-relevant one exists (transactions, engagement, profile), ONE narrow SQL call. If the metadata returns nothing promising, say so and move on — but you must still make the metadata call. The circuit breaker handles failures; do not skip out of caution.

Return structured JSON ONLY (no prose, no markdown fences):
{
  "greeting": "Good morning, ${firstName}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?" }
  ],
  "signoff": "One line, slightly personal, time-aware."
}`;
}
