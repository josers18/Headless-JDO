export interface SignalsArgs {
  bankerUserId: string;
  windowHours?: number;
}

/**
 * Signals prompt — the Live Signal Feed. This runs on a polling cadence
 * from the client (data_360 has no push subscription, so "live" is really
 * "recent"), so the agent must be fast: one round of tool calls, no long
 * reasoning. Keep the payload compact.
 */
export function signalsPrompt(a: SignalsArgs): string {
  const hours = a.windowHours ?? 24;
  return `Surface the most recent high-signal events across banker user id ${a.bankerUserId}'s book in the last ${hours} hours.

Primary source: data_360. Pull up to 6 signals — transactional anomalies, held-away movement, unusual engagement, life events. Cross-reference salesforce_crm only if you need to resolve a client id to a name. Do NOT call tableau_next. Be fast — one round of parallel tool calls is plenty.

Return JSON ONLY (no prose, no fences):
{
  "signals": [
    {
      "id": "sig_<shortid>",
      "client_id": "<sf id, optional>",
      "client_name": "<resolved name, optional>",
      "kind": "transaction" | "engagement" | "life_event" | "kpi" | "risk",
      "summary": "one sentence",
      "severity": "low" | "med" | "high",
      "timestamp": "<ISO 8601>",
      "source": "data_360" | "salesforce_crm" | "tableau_next"
    }
  ]
}`;
}
