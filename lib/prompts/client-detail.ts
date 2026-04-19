export interface ClientDetailArgs {
  clientId: string;
  clientName?: string;
  bankerUserId: string;
}

/**
 * Client Detail prompt — a streaming 360° view triggered by clicking a row
 * in the Priority Queue. We deliberately lean on all three Salesforce MCPs
 * in parallel so the banker sees a coherent picture: the business record,
 * behavioral signals, and the KPI context in one glance.
 */
export function clientDetailPrompt(a: ClientDetailArgs): string {
  const nameHint = a.clientName
    ? ` The client's display name is "${a.clientName}".`
    : "";
  return `Produce a 360° snapshot of client ${a.clientId} for banker user id ${a.bankerUserId}.${nameHint}

Fan out across all three MCP servers in parallel:
- salesforce_crm: resolve the Account/Contact, list open opportunities (stage + amount), recent tasks (last 30 days), any open cases.
- data_360: behavioral signals in the last 90 days (notable transactions, held-away movement, life events, digital engagement spikes).
- tableau_next: top 3 portfolio KPIs relevant to this client and how they moved in the last 30 days.

Return JSON ONLY (no prose, no fences):
{
  "client_id": "${a.clientId}",
  "name": "<resolved name>",
  "summary": "<= 2 sentences, lead with the insight",
  "profile": {
    "segment": "<string or null>",
    "relationship_since": "<yyyy-mm-dd or null>",
    "total_aum": "<string or null>"
  },
  "opportunities": [ { "id": "...", "name": "...", "stage": "...", "amount": "...", "close_date": "..." } ],
  "tasks": [ { "id": "...", "subject": "...", "status": "...", "due_date": "..." } ],
  "cases": [ { "id": "...", "subject": "...", "status": "...", "priority": "..." } ],
  "signals": [ { "kind": "transaction"|"engagement"|"life_event"|"risk"|"kpi", "summary": "...", "severity": "low"|"med"|"high", "source": "data_360"|"tableau_next"|"salesforce_crm" } ],
  "kpis": [ { "label": "...", "value": "...", "delta": "...", "direction": "up"|"down"|"flat" } ],
  "recommended_actions": [ { "kind": "task"|"email"|"update"|"call", "title": "...", "rationale": "..." } ]
}

Keep arrays short (≤ 5 entries each). If a data source returns nothing, emit an empty array for that field — do not fabricate.`;
}
