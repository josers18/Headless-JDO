export interface PortfolioPulseArgs {
  bankerUserId: string;
}

export function portfolioPulsePrompt(a: PortfolioPulseArgs): string {
  return `Produce a portfolio pulse for banker user id ${a.bankerUserId}.

TOOL SELECTION — STRICT RULES
A portfolio pulse MUST exercise at least two MCP servers. salesforce_crm gives you
raw pipeline/activity counts; tableau_next gives you governed KPIs and
period-over-period context. At least ONE of your final KPI tiles must be sourced
from tableau_next — pipeline-SOQL-only pulses are rejected.

Efficient plan — do not loop on errors, do not guess custom fields:
1. salesforce_crm (structured records): SELECT SUM(Amount) totalPipeline, COUNT(Id) oppCount FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false
2. salesforce_crm (structured records): SELECT SUM(Amount) wonLast30 FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsWon = true AND CloseDate = LAST_N_DAYS:30
3. salesforce_crm (structured records): SELECT COUNT(Id) recentActivity FROM Task WHERE OwnerId = '${a.bankerUserId}' AND CreatedDate = LAST_N_DAYS:7
4. tableau_next (REQUIRED — must attempt): call the semantic-models list tool (name starts with "getSemanticModels") filtered by Sales or Service category, then call the analytics Q&A tool (name starts with "analyze") ONCE with a concrete metric question tied to this banker's book (e.g. "What is the total pipeline change for OwnerId = ${a.bankerUserId} over the last 7 days?" or "What is the win-rate trend for this user over the last 30 days?"). Use the answer to produce ONE of your KPI tiles — tag it in the explanation as tableau_next-sourced.

Derive 2-3 KPIs from these results. For each, pick a concrete direction by comparing against a prior window when you have one; otherwise mark direction "flat" and say "insufficient history" in the explanation.

Return JSON ONLY (no prose, no fences):
{
  "narrative": "<= 60 words, lead with the most important number, plain prose, reads like an analyst summary",
  "kpis": [
    {
      "label": "Pipeline" | "Wins (30d)" | "Activity (7d)" | "...",
      "value": "$8.4M" | "12" | "...",
      "delta": "+$1.2M vs prior 30d" | "—" | "...",
      "direction": "up" | "down" | "flat",
      "explanation": "<= 20 words, tied to actual data you retrieved"
    }
  ]
}

Tone: calm, evidence-first. Never hype. If a KPI is neutral, say so plainly. Never invent numbers — if you can't compute a delta, say so.`;
}
