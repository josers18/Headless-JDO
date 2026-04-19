export interface PortfolioPulseArgs {
  bankerUserId: string;
}

export function portfolioPulsePrompt(a: PortfolioPulseArgs): string {
  return `Produce a portfolio pulse for banker user id ${a.bankerUserId}.

Efficient plan — do not loop on errors, do not guess custom fields:
1. salesforce_crm.soqlQuery: SELECT SUM(Amount) totalPipeline, COUNT(Id) oppCount FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false
2. salesforce_crm.soqlQuery: SELECT SUM(Amount) wonLast30 FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsWon = true AND CloseDate = LAST_N_DAYS:30
3. salesforce_crm.soqlQuery: SELECT COUNT(Id) recentActivity FROM Task WHERE OwnerId = '${a.bankerUserId}' AND CreatedDate = LAST_N_DAYS:7
4. tableau_next (optional, best-effort, ONE attempt): getSemanticModels(category: "Sales", limit: 10), then ONE analyzeSemanticData with a concrete metric question. If no relevant model, skip.

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
