/**
 * Stagger first agent-stream fetches on the signed-in home page so we do not
 * open 6–8 parallel MCP + inference sessions in the same tick (Heroku single
 * dyno + Managed Inference often return 503 under that burst).
 *
 * Spacing ~270–440ms between wave starts (mild compression vs older 350–500ms:
 * faster first paint sequence, same ordering). `/api/signals` stays off t=0 so
 * it does not race Morning Brief. Revert numbers if 503s return.
 */
export const AGENT_STAGGER_MS = {
  /** Morning brief — keep first. */
  brief: 0,
  pulseStrip: 300,
  /** First GET /api/signals poll — was t=0 and stacked with brief. */
  signals: 570,
  insightsBatch: 920,
  arc: 1360,
  priority: 1800,
  portfolioPulse: 2240,
  drafts: 2680,
} as const;
