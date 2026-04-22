/**
 * Stagger first agent-stream fetches on the signed-in home page so we do not
 * open 6–8 parallel MCP + inference sessions in the same tick (Heroku single
 * dyno + Managed Inference often return 503 under that burst).
 *
 * Spacing ~400–500ms between wave starts; `/api/signals` is delayed off t=0
 * so it does not race Morning Brief (both hit the agent loop otherwise).
 */
export const AGENT_STAGGER_MS = {
  /** Morning brief — keep first. */
  brief: 0,
  pulseStrip: 350,
  /** First GET /api/signals poll — was t=0 and stacked with brief. */
  signals: 650,
  insightsBatch: 1050,
  arc: 1550,
  priority: 2050,
  portfolioPulse: 2550,
  drafts: 3050,
} as const;
