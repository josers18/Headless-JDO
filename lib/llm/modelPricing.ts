/**
 * lib/llm/modelPricing.ts — approximate per-model token pricing for the
 * Token Spend panel's cost estimate. Importable from both server and client
 * (pure functions, no Node-only deps).
 *
 * ⚠️ THESE RATES ARE APPROXIMATE AND EDITABLE. They are list-price
 * references, not your contracted Heroku Managed Inference rates — adjust
 * the numbers below to match what you are actually billed. The panel labels
 * every cost as an estimate ("≈ est."), so being slightly off is expected.
 *
 * Units: US dollars per 1,000,000 tokens.
 */

export interface ModelRate {
  /** $/1M input (prompt) tokens. */
  inputPerM: number;
  /** $/1M output (completion) tokens. */
  outputPerM: number;
}

// Keyed by a substring that appears in the model id. Lookup is a
// case-insensitive "first key contained in the model id" match, so
// "claude-4-5-sonnet" matches the "claude" entry, "kimi-k2-thinking"
// matches "kimi", etc. Order matters only if one key is a substring of
// another (none are today).
const RATES: ReadonlyArray<{ match: string; rate: ModelRate }> = [
  // Claude 4.5 Sonnet via Heroku Managed Inference (Today / main stack).
  { match: "claude", rate: { inputPerM: 3, outputPerM: 15 } },
  // Kimi K2 Thinking — Ask My Data / Analyze reasoning tier.
  { match: "kimi", rate: { inputPerM: 0.6, outputPerM: 2.5 } },
  // MiniMax M2 — short tier (titles, follow-ups, chart selection).
  { match: "minimax", rate: { inputPerM: 0.3, outputPerM: 1.2 } },
];

/** Fallback when no rate is configured for a model — yields $0, never NaN. */
const ZERO_RATE: ModelRate = { inputPerM: 0, outputPerM: 0 };

/** Resolve the rate for a model id, or a zero rate if none is configured. */
export function rateFor(model: string): ModelRate {
  const lc = model.toLowerCase();
  for (const { match, rate } of RATES) {
    if (lc.includes(match)) return rate;
  }
  return ZERO_RATE;
}

/** True when we have a real (non-zero) rate for this model. */
export function hasRate(model: string): boolean {
  const r = rateFor(model);
  return r.inputPerM > 0 || r.outputPerM > 0;
}

/** Estimated USD cost for a model's input + output token counts. */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const r = rateFor(model);
  return (
    (inputTokens / 1_000_000) * r.inputPerM +
    (outputTokens / 1_000_000) * r.outputPerM
  );
}
