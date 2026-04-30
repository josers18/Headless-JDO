/**
 * Prep prompt — a focused "brief me on this client right now" agent call.
 * Used by the Prep me action across Priority Queue rows, Pre-drafted Action
 * cards, and the Client Detail Sheet.
 *
 * The banker is about to walk into a call / compose an email / review a
 * relationship. They need: situation (what's true now), why it matters,
 * three concrete next-step options, ranked.
 */

export const PREP_PROMPT_VERSION = "v1.0.1-2026-04-24";

export interface PrepPromptInput {
  clientId: string;
  clientName?: string;
  bankerName: string;
  reason?: string;
}

export function prepPrompt({
  clientId,
  clientName,
  bankerName,
  reason,
}: PrepPromptInput): string {
  const who = clientName ? `${clientName} (${clientId})` : clientId;
  const whyLine = reason
    ? `REASON FOR PREP: ${reason}`
    : "REASON FOR PREP: the banker is entering a conversation with this client soon.";
  return `${bankerName} is about to engage with ${who}. Produce a tight pre-call briefing.

${whyLine}

CONSULT (in parallel):
- salesforce_crm — recent tasks, meetings, open opportunities, last activity date, case history
- data_360 — recent transactions, behavioral signals, held-aways, life events, digital engagement in last 30 days
- tableau_next — any KPI that moved for this relationship in the last week

HARD RULES:
- Output JSON only. No markdown fence, no prose before/after.
- Never include raw Salesforce record Ids in prose — always use names.
- Keep it skimmable in <10 seconds. The banker is about to dial.
- data_360: call the data_360 metadata tool before any SQL; use only column names that appear verbatim in that response for the DMO you query. Never invent CRM-shaped DMO columns like AccountId__c or OwnerId__c — they are not valid just because SOQL uses AccountId / OwnerId.

OUTPUT:
{
  "situation": "2-sentence factual ground truth (last contact, notable recent activity, open deals or issues).",
  "why_it_matters": "1-sentence stake — what's at risk / what's possible right now.",
  "next_steps": [
    { "label": "≤ 6 word imperative, e.g. 'Call about bridge loan'", "detail": "1 sentence of why + how", "kind": "call" | "email" | "task" | "meeting" },
    { "label": "...", "detail": "...", "kind": "..." },
    { "label": "...", "detail": "...", "kind": "..." }
  ],
  "sources_used": ["salesforce_crm" | "data_360" | "tableau_next"]
}

If a tool returns empty for this client, omit that source from sources_used and say so plainly in situation (e.g. "No transactions in data_360 for this relationship in the last 30 days.").
`;
}
