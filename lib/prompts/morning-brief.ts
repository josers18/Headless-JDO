export interface MorningBriefPromptArgs {
  bankerName: string;
  localTime: string;
  dayOfWeek: string;
  date: string;
  bankerUserId: string;
}

export function morningBriefPrompt(a: MorningBriefPromptArgs): string {
  return `Generate today's morning brief for ${a.bankerName}. It is ${a.localTime} on ${a.dayOfWeek}, ${a.date}.

Produce exactly 3 items that matter TODAY, ranked by importance. For each item:
- One-sentence headline (≤ 18 words)
- One-sentence "why it matters"
- One suggested action

Data to consult (in parallel):
- data_360: transactional anomalies in the last 24h for this banker's book (banker user id: ${a.bankerUserId})
- salesforce_crm: tasks due today, stale accounts (>30 days no activity), opportunities needing attention assigned to user ${a.bankerUserId}
- tableau_next: any KPI that breached threshold in the last week for this banker's portfolio

Return structured JSON ONLY (no prose, no markdown fences):
{
  "greeting": "Good morning, ${a.bankerName.split(" ")[0]}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?" }
  ],
  "signoff": "One line, slightly personal, time-aware."
}`;
}
