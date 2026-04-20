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

RANKING — additional rules (these govern WHICH items survive into the final 3):

- Reversibility beats magnitude. An item actionable TODAY or THIS WEEK ranks
  above a larger item that can only be addressed weeks from now. A $50K deal
  closing Friday outranks a $5M deal closing in two months.

- Overdue-task freshness cap. When ranking overdue tasks for the brief,
  consider ONLY tasks overdue by ≤ 14 days. Tasks overdue > 14 days are
  housekeeping backlog, not a morning signal — do not surface them as brief
  items, and do not quote their exact overdue day-count in any headline.
  Exception: if the banker has zero fresh overdue tasks (≤ 14 days) AND
  zero other hot signals (meetings today, deals closing this week, live
  cross-source discrepancies, recent life events), you MAY surface ONE
  stale-overdue item phrased as "X open tasks need triage" — aggregated,
  never pointing at a single year-old row. This is the graceful-empty
  path, not the default.

- The #1 item must be one of:
    a) actionable within the next 48 hours (a meeting, a deal step, a call),
    b) tied to a dated trigger (market event, maturity, life event this week), OR
    c) a live cross-source discrepancy (CRM says one thing, Data Cloud or
       Tableau Next says another) that becomes less reversible the longer
       it sits. These are legitimate hero items even without a 48-hour clock.

- Never quote an overdue day-count > 30 in a headline. If a task is 382 days
  overdue, the banker knows. Saying it is scolding, not helpful. Reframe as
  "Long-stale insurance review for Judy Odom" or similar, OR drop the item.

Efficient plan (one pass — do not retry on errors):
1. salesforce_crm (structured records): SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name, Priority FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY Priority DESC LIMIT 15
2. salesforce_crm (structured records): SELECT Id, Name, LastActivityDate, AnnualRevenue, Industry FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
3. salesforce_crm (structured records): SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 15
4. tableau_next (REQUIRED — must attempt): call the semantic-models list tool (name starts with "getSemanticModels") filtered by a Sales or Service category, then call the analytics Q&A tool (name starts with "analyze") ONCE with a concrete metric question tied to this banker ("what is the pipeline change for OwnerId = ${a.bankerUserId} over the last 7 days?"). Use the result to generate ONE of your 3 items (a KPI-driven signal).
5. data_360 (REQUIRED — must attempt): call the Data Cloud metadata tool (name starts with "getDcMetadata") to discover available DLOs/DMOs. THEN — before writing any SQL — pick ONE obviously-relevant DMO (transactions, engagement, profile, life events) and locate it in the metadata response's fields array. Confirm the 2–3 columns you intend to SELECT appear CHARACTER-FOR-CHARACTER in that array (case-sensitive, full prefix). Only then emit ONE narrow SQL call (SELECT specific columns, LIMIT 20, qualified by OwnerId where applicable). If the fields array doesn't contain the columns you want verbatim — do NOT submit bare variants like "name" or "id" when the real column is "ssot__Name__c" etc. — skip the SQL for this run and note "no usable Data Cloud columns" in the relevant brief item instead. The circuit breaker will block any second data_360 call after a schema miss, so the SQL must be right on the first try or not happen.

Return structured JSON ONLY (no prose, no markdown fences):
{
  "greeting": "Good morning, ${firstName}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?" }
  ],
  "signoff": "One line, slightly personal, time-aware."
}`;
}
