export interface PortfolioPulseArgs {
  bankerUserId: string;
}

export function portfolioPulsePrompt(a: PortfolioPulseArgs): string {
  return `Produce a portfolio pulse for banker user id ${a.bankerUserId}.

TOOL SELECTION — three first-class sources, each required for a full pulse:
  - salesforce_crm  → pipeline counts, win counts, activity counts (first-party)
  - tableau_next    → governed ratios and period-over-period (narrative KPIs) — REQUIRED for at least one tile
  - data_360        → unified AUM / held-aways / cross-source engagement (external flows CRM cannot compute)

A strong pulse exercises Tableau Next for at least one tile and reaches for Data 360 when its criteria fire. A CRM-only pulse is allowed ONLY when Tableau Next genuinely errors or returns no bindable model — in that case say so honestly in the narrative ("governed comparisons unavailable this session"), do not fabricate.

HARD BUDGET: Maximum 5 tool calls total. Stop calling tools once you have 2–3 honest KPIs.

Efficient plan — one pass, no retries on errors, do not guess custom fields:
1. salesforce_crm (structured records): SELECT SUM(Amount) totalPipeline, COUNT(Id) oppCount FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false
2. salesforce_crm (structured records): SELECT SUM(Amount) wonLast30 FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsWon = true AND CloseDate = LAST_N_DAYS:30
3. salesforce_crm (structured records): SELECT COUNT(Id) recentActivity FROM Task WHERE OwnerId = '${a.bankerUserId}' AND CreatedDate = LAST_N_DAYS:7

4. tableau_next (REQUIRED — always attempt). Tableau-sourced KPIs are the core differentiator of the pulse: CRM counts alone cannot compute period-over-period ratios or governed win-rate. At LEAST ONE KPI tile must come from tableau_next in a normal (non-degraded) pulse.

   EXECUTION (one pass, no retries):
   a) getSemanticModels ONCE (category filter "Sales" is OK ONLY to narrow the list).
   b) Pick ONE real model identifier from a returned row — copy verbatim; NEVER pass "Sales"/"Service" as the model id.
   c) One analyze call asking ONE concrete metric question tied to this banker's book (pipeline change last 7d, win rate, AUM trend, etc.).
   d) Tag the resulting tile with a tableau_next source.
   e) If getSemanticModels errors, returns no rows, or analyze errors: do NOT retry. Ship the pulse as CRM + DC with a narrative line like "Governed comparisons unavailable this session."

5. data_360 (PRESCRIPTIVE — call when ANY criterion below is met). This surfaces unified AUM, held-aways, and cross-source engagement that neither CRM nor Tableau can compute. Skipping when a criterion applies means the pulse misses the banker's most-asked-about number: "how much wealth do my clients hold outside our platform?"

   CALL data_360 IF ANY OF:
   - The banker's book has HNW / affluent accounts — surface held-away AUM delta as a KPI tile (this is the highest-signal tile for HNW bankers).
   - Step 2 returned zero wins — surface unified pipeline-plus-held-aways as a forward-looking tile that reframes the zero.
   - It is a Monday OR the start of a month — surface weekly/monthly unified engagement score (tile: "Book health").
   - Tableau (step 4) was skipped or errored AND CRM-only KPIs would be thin — fill the gap with a DC-sourced tile rather than a single-source pulse.

   SKIP data_360 ONLY IF: getDcMetadata errors, no DMOs match any criterion, or you already have 3 strong KPI tiles from steps 1–4.

   EXECUTION (one pass, no retries):
   a) getDcMetadata ONCE unfiltered.
   b) Pick ONE DMO matching the triggered criterion (held-aways, unified engagement, cross-source transaction).
   c) Verify every column verbatim in fields[] — case-sensitive, full prefix.
   d) One narrow postDcQuerySql (LIMIT 20, OwnerId-qualified when the DMO exposes it).
   e) If columns don't match, skip SQL — the breaker blocks retries anyway.

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
