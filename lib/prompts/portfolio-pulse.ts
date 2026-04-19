export interface PortfolioPulseArgs {
  bankerUserId: string;
}

/**
 * Portfolio Pulse — a short narrative + 2–3 hero KPIs derived from
 * tableau_next. Deliberately scoped to the banker's portfolio so it feels
 * personal; we cross-reference data_360 when a signal explains a delta.
 */
export function portfolioPulsePrompt(a: PortfolioPulseArgs): string {
  return `Produce a portfolio pulse for banker user id ${a.bankerUserId}.

Primary source: tableau_next.analyze_data. Pull 2-3 KPIs that matter this week for THIS banker's portfolio (e.g., AUM momentum, pipeline coverage, retention risk, fee realization). For each KPI, compare to the prior 7 days. If a data_360 signal explains the delta, mention it in the narrative.

Return JSON ONLY (no prose, no fences):
{
  "narrative": "<= 60 words, lead with the most important delta, plain prose, reads like an analyst summary",
  "kpis": [
    {
      "label": "...",
      "value": "...",
      "delta": "...",
      "direction": "up" | "down" | "flat",
      "explanation": "<= 20 words"
    }
  ]
}

Tone: calm, evidence-first. Never hype. If a KPI is neutral, say so plainly.`;
}
