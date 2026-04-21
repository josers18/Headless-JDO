export interface ActionDraftArgs {
  clientId: string;
  context: string;
  kind: "task" | "email" | "update" | "call";
}

export function actionDraftPrompt(a: ActionDraftArgs): string {
  return `Draft a ${a.kind} for client ${a.clientId} given this context:

${a.context}

Resolve the client with salesforce_crm first. Pull one supporting signal from data_360 or tableau_next if it strengthens the action. Then produce a DRAFT — do not execute any writes.

NAMING HYGIENE (title + body — P-1):
- Never print the same person or account name twice within 10 words in a single sentence (e.g. BAD: "Julie Morris at Julie Morris account…"). Prefer possessive phrasing: "Julie Morris's account…" or drop the redundant account reference if it adds no disambiguation.
- If Contact.Name equals Account.Name and both must appear, disambiguate once with role words ("her household", "the business account") — do not repeat the bare name twice.

In title and body, use human-readable Account, Contact, and Opportunity names. Put Salesforce record Ids only in target_id — never paste raw 15/18-character Ids into title or body as link text.

Return JSON ONLY:
{
  "id": "draft_<shortid>",
  "kind": "${a.kind}",
  "title": "…",
  "body": "…",
  "target_object": "Account"|"Contact"|"Opportunity"|"Task"|"Case",
  "target_id": "…",
  "confidence": 0-100
}`;
}
