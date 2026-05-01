export interface DraftQueueArgs {
  bankerUserId: string;
  count?: number;
}

/**
 * Draft Queue prompt — produce a short list of pre-drafted actions the
 * banker can approve with one click. Write-back counterpart to the
 * Priority Queue: same evidence gathering, but the output is a set of
 * executable drafts rather than a ranked list.
 *
 * Critical guarantee (CLAUDE.md §7 rule 7): the model DRAFTS only. It
 * must NOT call any writing tools. Execution happens in /api/actions
 * after the banker clicks Approve.
 */
export function draftQueuePrompt(a: DraftQueueArgs): string {
  const n = a.count ?? 3;
  return `You are drafting ${n} high-signal actions banker user id ${a.bankerUserId} should take TODAY.

HARD BUDGET: Maximum 5 tool calls total. Do ONE pass of evidence-gathering, then draft ALL ${n} actions from the results. Do NOT re-query between drafts. Do NOT re-run the same SOQL with slightly different arguments. Once you have evidence for ${n} actions, STOP calling tools and emit the JSON.

Efficient plan — ONE pass, read-only tools only, do NOT write:
1. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY LastActivityDate ASC NULLS FIRST LIMIT 15
2. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY LIMIT 15
3. salesforce_crm.soqlQuery: SELECT Id, Name, LastActivityDate, AnnualRevenue FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
4. data_360 (PRESCRIPTIVE — call when ANY criterion below is met). The best drafts have a CONCRETE hook — a specific event or behavior the banker can reference. DC surfaces those hooks (a recent wire, a login gap, an engagement drop) that CRM activity fields won't show.

   CALL data_360 IF ANY OF:
   - Step 1 returned stalled Opportunities (LastActivityDate > 30d) — check for digital-engagement drops; a "we noticed you haven't logged in — anything we can help with?" email is far stronger than a generic "checking in".
   - Step 2 returned no overdue tasks (no obvious hook from CRM) — check recent behavioral life-event inference (address change, employer change, dependent added) to seed a warm-touch outreach draft.
   - Step 3 returned stale accounts (>30d no activity) — check for external wire/ACH anomalies on those accounts; a wire-triggered draft outranks a generic "we haven't talked lately" note.

   SKIP data_360 ONLY IF: the DATA CLOUD CATALOG block is absent from the system prompt, OR no DMOs match any criterion, or steps 1–3 already gave you enough concrete hooks for ${n} strong drafts.

   EXECUTION (one pass, no retries):
   a) Pick a DMO VERBATIM from the DATA CLOUD CATALOG block in the system prompt — do NOT call any metadata tool, it has been filtered out of your tools this turn and returns "Unknown tool". If the catalog is absent, skip DC entirely.
   b) Pick ONE DMO matching the triggered criterion.
   c) Verify every column verbatim in fields[] — case-sensitive, full prefix.
   d) One narrow call on the data_360 SQL tool (LIMIT 20, filter by account ids from steps 1–3 where possible).
   e) If columns don't match, skip SQL and draft from CRM-only hooks — the breaker blocks retries anyway.

Hard rules for the drafts:
- DRAFT ONLY. Do NOT call any tool that writes, creates, updates, or sends.
- Every target_id must come from a real record id that one of your read queries actually returned. Do NOT fabricate ids.
- Distribute across action kinds when possible (one email, one task, one update, one call).
- Titles ≤ 70 chars. Bodies ≤ 220 chars. Be specific: named client, named metric, named opportunity.

Return JSON ONLY (no prose, no fences):
{
  "drafts": [
    {
      "id": "draft_<shortid>",
      "kind": "task" | "email" | "update" | "call",
      "title": "...",
      "body": "...",
      "target_object": "Account" | "Contact" | "Opportunity" | "Task" | "Case",
      "target_id": "<real sf id from your results>",
      "confidence": 0-100,
      "rationale": "one sentence — what evidence drove this draft"
    }
  ]
}`;
}
