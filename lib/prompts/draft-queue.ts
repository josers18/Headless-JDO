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
4. data_360 — call when steps 1–3 didn't surface ${n} strong concrete hooks. The best drafts reference a SPECIFIC recent transaction; DC surfaces those (recent wires, large amounts) that CRM activity fields won't show.

   EXECUTION — emit this SQL VERBATIM via the data_360 SQL tool. Do NOT modify the table or column names. Do NOT call a metadata tool — it's filtered out of your tool list this turn and returns "Unknown tool".

   sql: SELECT "accountid__c", "amount__c", "transactiondate__c", "transaction_type__c", "description__c" FROM "Financial_Transactions_Snow_XL__dll" WHERE "transactiondate__c" >= TIMESTAMP '2024-06-01 00:00:00 UTC' ORDER BY "amount__c" DESC LIMIT 20

   The cutoff is anchored to the most recent month of transaction data available in this org — do NOT use CURRENT_DATE; the demo-org transaction stream ends 2024-06-30 and a relative window returns zero rows. Do NOT add an \`accountid__c IN (...)\` clause — the DC \`accountid__c\` namespace does not match Salesforce \`Account.Id\`, so a CRM-id IN clause returns zero rows.

   Use rows from this result to seed drafts: a large recent transaction is a strong hook ("noticed a $2,799 charge in <description> on <date> — want to review?"). \`accountid__c\` from the result is the Data Cloud account id (NOT a Salesforce record id) — use it as the draft \`rationale\` evidence, and pick \`target_object\` / \`target_id\` from a real CRM record returned by step 1 or 3.

   SKIP data_360 ONLY IF: the DATA CLOUD CATALOG block is absent from the system prompt (cache miss), OR steps 1–3 already gave you ${n} strong CRM-grounded hooks. If the call errors, do NOT retry — draft from CRM-only hooks.

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
