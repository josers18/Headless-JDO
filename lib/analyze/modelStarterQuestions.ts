/**
 * Per-semantic-model starter questions for Analyze.
 *
 * Each SDM on the demo org gets a hand-authored set of 3–4 questions
 * grounded in the model's domain. Keyed by apiName so the mapping is
 * stable across label renames (Tableau's apiName is the stable ID).
 *
 * Fallback: any SDM without an explicit entry gets the GENERIC set.
 *
 * Design principles:
 *  - Every question phrased the way a banker would type it.
 *  - Each question is a complete ask (not "tell me about X") — lands
 *    in Analytics Agent's sweet spot.
 *  - 4 questions per SDM: one trend, one comparison, one ranking, one
 *    aggregate/KPI — covers the main chart archetypes the UI can render.
 */

const GENERIC: readonly string[] = [
  "What's the overall trend over the last 12 months?",
  "Show me the top 5 performers",
  "What's the current aggregate value?",
  "Break this data down by category",
];

const BY_API_NAME: Record<string, readonly string[]> = {
  // ─── Customer experience ─────────────────────────────────────────────
  CSAT_NPS_Model: [
    "Show CSAT by month as a time series",
    "Compare CSAT Trends and NPS Trends over the last 12 months",
    "Which months had the lowest CSAT scores?",
    "What's the overall average NPS?",
  ],
  CSAT_NPS_Model_Extended_9fe: [
    "Show CSAT by month as a time series",
    "Compare CSAT and NPS by fiscal quarter",
    "Which segments have the worst CSAT?",
    "What's the latest NPS trend?",
  ],

  // ─── Banking / Finserv data ──────────────────────────────────────────
  Financial_Accounts: [
    "Show total balance by account type",
    "Which account types have the highest average balance?",
    "How many accounts were opened in the last 12 months?",
    "Break down accounts by status",
  ],
  Transactions: [
    "Show transaction volume by month",
    "Which transaction types drive the most debits?",
    "What's the average transaction amount by account type?",
    "Show the top 10 spending categories this year",
  ],
  Trades: [
    "Show trade volume by month",
    "Which asset classes have the highest trade value?",
    "Top 5 traded securities this quarter",
    "What's the total trade value year-to-date?",
  ],

  // ─── Sales / opportunities ───────────────────────────────────────────
  Case_Model: [
    "Show case volume by month",
    "Which case statuses are most common?",
    "Average case resolution time by priority",
    "Top 5 case reasons this quarter",
  ],
  Case_Model_1: [
    "Show opportunity pipeline by stage",
    "Which opportunity owners closed the most this quarter?",
    "Average deal size by industry",
    "What's the overall close rate?",
  ],
  Campaigns: [
    "Show campaign spend by month",
    "Which campaigns drove the most leads?",
    "Compare opened vs clicked rates across campaigns",
    "What's the average cost per lead this quarter?",
  ],

  // ─── Agentforce analytics family ────────────────────────────────────
  sfm_Agentforce_Analytics_Foundations: [
    "Show agent interactions by month",
    "Which intents drive the most conversations?",
    "Top 5 handoff reasons",
    "What's the overall agent deflection rate?",
  ],
  Agentforce_Interactions_Explorer_Semantic_Model: [
    "Show interaction volume by week",
    "Which topics are trending this month?",
    "Compare resolved vs escalated interactions",
    "What percentage of interactions were resolved by the agent?",
  ],
  Employee_Agent_Analytics_SDM_9fe: [
    "Show employee agent usage by month",
    "Which departments use the agent most?",
    "Top 5 employee intents",
    "What's the average session duration?",
  ],
  Service_Agent_Analytics_SDM_9fe: [
    "Show service cases handled by the agent by month",
    "Compare agent-resolved vs human-escalated cases",
    "Which service topics the agent handles best",
    "What's the agent's current deflection rate?",
  ],

  // ─── Audit / platform ───────────────────────────────────────────────
  GenAI_Audit: [
    "Show GenAI usage by day over the last 30 days",
    "Which prompts run most often?",
    "Top 5 users by GenAI requests",
    "What's the total GenAI request volume this month?",
  ],
  Platform_Events: [
    "Show platform event volume by type",
    "Which event types fire most often?",
    "Compare event volume week over week",
    "What's the peak hour for event firing?",
  ],

  // ─── Fallthrough cases with no useful domain to tailor against ──────
  Data_Mask: [
    "How many records have been masked?",
    "Show mask coverage by object",
    "Which fields are most often masked?",
    "What's the unmasked-record count?",
  ],
  Test_Semantic_Model: [
    "What data is in this test model?",
    "Show me the first 10 records",
    "List available fields",
    "Show record count by category",
  ],
};

/**
 * Return the starter questions for a given SDM. `apiName` lookup wins;
 * falls back to the generic set if no tailored questions exist.
 */
export function getStarterQuestions(apiName: string): readonly string[] {
  return BY_API_NAME[apiName] ?? GENERIC;
}
