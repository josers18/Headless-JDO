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
4. tableau_next (REQUIRED — must attempt): getSemanticModels (Sales/Service category filter only narrows the list). Then ONE analyze call — bind targetEntityIdOrApiName (or equivalent) to a real id/apiName from one returned row, never the word "Sales" or "Service". One concrete metric question for this banker (pipeline change, win rate, etc.). Use the answer for ONE KPI tile tagged tableau_next-sourced; if you cannot bind a model, skip Tableau for this run and say so in narrative.

Derive 2-3 KPIs from these results. For each, pick a concrete direction by comparing against a prior window when you have one; otherwise mark direction "flat" and say "insufficient history" in the explanation.

METRIC HYGIENE (mandatory — bankers lose trust on noisy tiles):
1. MONEY COMPARISONS: Never put a period-over-period comparison in "delta" when BOTH the current-period total and the prior-period total are under USD 100,000. In that case set "delta" to "—", direction "flat", and explain briefly that movement is below the reporting threshold.
2. RELATIVE NOISE: If the relative change between two compared money totals is under 20%, treat it the same way — "—", direction "flat", do not imply a trend.
3. ZERO WINS: When the label is about closed wins (e.g. "Wins (30d)") and the value is $0, set direction "flat", delta exactly "No closed wins this period.", and do NOT show a negative dollar delta vs prior (that reads like fake drama).
4. ZERO / TINY COUNTS: For Activity (7d) with a single task and no meaningful prior window, delta should be one short factual line such as "Single task created this week." Do NOT append "no prior-week comparison available" — that adds no value.
5. Never invent prior-window numbers. If you cannot compute a honest delta, use "—" and direction "flat".

BANKER-FACING COPY (field "narrative", "delta", "explanation" — P-2 / C-2):
- Never write the words "Tableau", "semantic model", "MCP", "SOQL", or "Data 360" in any user-facing string. If analytics or governed metrics are unavailable, say e.g. "Benchmark comparisons unavailable this session." or "Period-over-period context will return once analytics reconnect."
- When closed wins are $0 for the period, pivot forward: name 2–3 pipeline opportunities that could still close this month instead of implying someone "drove" a zero.

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
