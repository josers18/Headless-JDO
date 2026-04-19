export interface PriorityQueueArgs {
  bankerUserId: string;
  topN?: number;
}

export function priorityQueuePrompt(a: PriorityQueueArgs): string {
  const n = a.topN ?? 5;
  return `Rank the top ${n} clients this banker (user id: ${a.bankerUserId}) should touch TODAY.

Use all three MCP servers in parallel:
- salesforce_crm: open opportunities, overdue tasks, recently-escalated cases
- data_360: behavioral signals (held-away movement, unusual transactions, life events, recent web/app engagement spikes)
- tableau_next: portfolio KPI deltas at the client level in the last 7 days

Return JSON ONLY:
{
  "clients": [
    { "client_id": "...", "name": "...", "reason": "one sentence", "score": 0-100, "sources": ["data_360"|"salesforce_crm"|"tableau_next"] }
  ]
}

Score should reflect urgency × opportunity value. Be selective — 3 high-signal entries beat 10 soft ones.`;
}
