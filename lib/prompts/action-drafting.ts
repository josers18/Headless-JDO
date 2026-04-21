export interface ActionDraftArgs {
  clientId: string;
  context: string;
  kind: "task" | "email" | "update" | "call";
}

export function actionDraftPrompt(a: ActionDraftArgs): string {
  return `Draft a ${a.kind} for client ${a.clientId} given this context:

${a.context}

Resolve the client with salesforce_crm first. Pull one supporting signal from data_360 or tableau_next if it strengthens the action. Then produce a DRAFT — do not execute any writes.

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
