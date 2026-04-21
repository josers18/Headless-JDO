/**
 * Section Insight prompt — one-sentence "so what?" callouts that sit above
 * each major surface (Priority Queue, Portfolio Pulse, Pre-drafted Actions,
 * Live Signals) and interpret the section data for the banker.
 *
 * The banner is the agent's *editorial* on the section: why this content
 * matters right now, ranked by urgency. It must be ≤ 24 words, lead with
 * the headline takeaway, and optionally propose one next step.
 */

export const SECTION_INSIGHT_PROMPT_VERSION = "v1.1.0-2026-04-21";

export type SectionKind = "priority" | "pulse" | "drafts" | "signals";

/** One editorial banner row (parsed JSON from `/api/insights`). */
export type InsightPayload = {
  tone: "calm" | "attention" | "urgent";
  headline: string;
  action_hint: string | null;
};

const SECTION_CONTEXT: Record<SectionKind, string> = {
  priority:
    "The Priority Queue ranks up to 10 clients needing attention today, grouped by urgency (today / this week / watch).",
  pulse:
    "Portfolio Pulse is 3 governed KPIs from tableau_next, each with a delta from the prior period.",
  drafts:
    "Pre-drafted Actions are 3–5 specific next steps (emails, calls, tasks) the agent has pre-drafted for this banker's book.",
  signals:
    "The Live Signal Feed is an ambient stream of the last ~12 changes across salesforce_crm + data_360 (severity-coded).",
};

const SECTION_FOCUS: Record<SectionKind, string> = {
  priority:
    "Which tier is most concerning today, and is there a theme (e.g. many overdue follow-ups, several HNW clients at once)?",
  pulse:
    "Which KPI moved most, and is that movement good or bad? If multiple moved, what's the one-line through-line?",
  drafts:
    "Which drafted action is highest-leverage right now? Is there a time-sensitive one (overdue, at-risk) the banker should tackle first?",
  signals:
    "Is there a pattern across the recent signals (many from one client, a cluster of risk events, an engagement spike)?",
};

export function sectionInsightPrompt({
  section,
  bankerName,
}: {
  section: SectionKind;
  bankerName: string;
}): string {
  return `You are writing a one-line editorial banner that sits above the ${section.toUpperCase()} section of ${bankerName}'s Horizon home page.

CONTEXT: ${SECTION_CONTEXT[section]}

FOCUS: ${SECTION_FOCUS[section]}

Consult the appropriate MCP servers in parallel to assess the CURRENT state of this section (don't guess). Then produce a terse "so what?" callout.

HARD RULES:
- Output JSON only, no markdown fence, no prose before or after.
- ≤ 24 words total across headline + action_hint combined.
- Never include raw Salesforce Ids in the prose — use names or generic phrasing.
- Banker-facing prose only: never write Tableau, semantic model, MCP, SOQL, or Data 360.
- If the section is empty or quiet, say so plainly ("Quiet section — nothing to action right now.") and set action_hint to null.

OUTPUT:
{
  "tone": "calm" | "attention" | "urgent",
  "headline": "string — 1 sentence, lead with the takeaway. E.g. 'Three HNW follow-ups all slipped past 14 days — oldest is Patel.'",
  "action_hint": "string — 1 short suggested next step, OR null if nothing actionable. E.g. 'Start with Patel: a brief 2-line nudge is drafted below.'"
}
`;
}

const ALL_SECTIONS: SectionKind[] = [
  "priority",
  "pulse",
  "drafts",
  "signals",
];

export function sectionInsightBatchSections(): readonly SectionKind[] {
  return ALL_SECTIONS;
}

/**
 * Single agent turn that replaces N parallel /api/insights calls — critical for
 * home-page performance (one MCP connect + one tool wave vs four).
 */
export function sectionInsightBatchPrompt({
  bankerName,
}: {
  bankerName: string;
}): string {
  const blocks = ALL_SECTIONS.map((section) => {
    return `### ${section.toUpperCase()}
CONTEXT: ${SECTION_CONTEXT[section]}
FOCUS: ${SECTION_FOCUS[section]}`;
  }).join("\n\n");

  return `You are writing four one-line editorial banners for ${bankerName}'s Horizon home page — one above Priority Queue, Portfolio Pulse, Pre-drafted Actions, and Live Signals.

${blocks}

PERFORMANCE: Prefer ONE coordinated wave of parallel MCP tool calls that gathers enough real data to assess all four sections (don't repeat redundant listTools/describe passes). If a source errors, acknowledge unknowns briefly — don't retry the same failing query pattern.

HARD RULES:
- Output a single JSON object only — no markdown fence, no prose outside the object.
- Each section's headline + action_hint combined ≤ 24 words.
- Never include raw Salesforce Ids — use names or generic phrasing.
- Banker-facing prose only: never write Tableau, semantic model, MCP, SOQL, or Data 360. Use "book KPIs", "benchmark data", "CRM", or "unified data" instead.
- If a section is empty or quiet, say so plainly for that section and set action_hint to null.

OUTPUT SHAPE:
{
  "priority": { "tone": "calm" | "attention" | "urgent", "headline": "string", "action_hint": "string | null" },
  "pulse": { "tone": "...", "headline": "...", "action_hint": "..." },
  "drafts": { "tone": "...", "headline": "...", "action_hint": "..." },
  "signals": { "tone": "...", "headline": "...", "action_hint": "..." }
}
`;
}
