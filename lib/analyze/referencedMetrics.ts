/**
 * Identify which of an SDM's named metrics the assistant's narrative
 * referenced. Pure string-match (Q-T2-5-a = B) — cheap, deterministic,
 * runs client-side.
 *
 * Matches both the metric's label ("CSAT Trends") and its apiName
 * ("CSAT_Trends_mtc") so it catches cases where the narrative happens
 * to echo the raw apiName (rare but possible).
 *
 * Case-insensitive. Whole-name match (not substring) — "CSAT" alone
 * wouldn't match "CSAT Trends" but a narrative saying "CSAT Trends
 * rose to 73.55" would.
 */

import type { SemanticModelMetric } from "./types";

export function referencedMetricsFromText(
  narrative: string,
  metrics: readonly SemanticModelMetric[]
): SemanticModelMetric[] {
  if (!narrative || metrics.length === 0) return [];
  const haystack = narrative.toLowerCase();
  const found: SemanticModelMetric[] = [];
  const seen = new Set<string>();

  for (const m of metrics) {
    if (seen.has(m.apiName)) continue;
    const label = m.label.toLowerCase();
    const api = m.apiName.toLowerCase();
    if (haystack.includes(label) || haystack.includes(api)) {
      found.push(m);
      seen.add(m.apiName);
    }
  }
  return found;
}
