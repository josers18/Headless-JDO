export interface DraftQueueArgs {
  bankerUserId: string;
  count?: number;
}

/**
 * Draft Queue prompt — produce a short list of pre-drafted actions the
 * banker can approve with one click. This is the write-back counterpart
 * to the Priority Queue: same evidence gathering, but the output is a set
 * of executable drafts rather than a ranked list.
 *
 * Critical guarantee (CLAUDE.md §7 rule 7): the model DRAFTS only. It
 * must NOT call any writing tools. Execution happens in /api/actions
 * after the banker clicks Approve.
 */
export function draftQueuePrompt(a: DraftQueueArgs): string {
  const n = a.count ?? 3;
  return `You are drafting ${n} high-signal actions banker user id ${a.bankerUserId} should take TODAY.

Rules:
- DRAFT ONLY. Do NOT call any tool that writes, creates, updates, or sends. Read-only tools across salesforce_crm, data_360, and tableau_next are expected.
- Each draft must be tied to a real Salesforce record id surfaced by salesforce_crm — no fabricated ids.
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
      "target_id": "<real sf id>",
      "confidence": 0-100,
      "rationale": "one sentence — what evidence drove this draft"
    }
  ]
}`;
}
