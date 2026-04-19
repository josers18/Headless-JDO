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

Efficient plan — one pass, read-only tools only, do NOT write:
1. salesforce_crm.soqlQuery: SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY LastActivityDate ASC NULLS FIRST LIMIT 15
2. salesforce_crm.soqlQuery: SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY LIMIT 15
3. salesforce_crm.soqlQuery: SELECT Id, Name, LastActivityDate, AnnualRevenue FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
4. (Optional) data_360 with getDcMetadata first — only if it strengthens a draft. Do not retry on errors.

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
