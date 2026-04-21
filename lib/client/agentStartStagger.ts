/**
 * Stagger first agent-stream fetches on the signed-in home page so we do not
 * open 6–7 parallel MCP client bundles in the same tick (Heroku single dyno
 * can return 503 under that burst).
 */
export const AGENT_STAGGER_MS = {
  /** Morning brief — keep first. */
  brief: 0,
  pulseStrip: 100,
  insightsBatch: 200,
  arc: 320,
  priority: 440,
  portfolioPulse: 560,
  drafts: 680,
} as const;
