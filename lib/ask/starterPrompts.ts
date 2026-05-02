/**
 * Static starter prompts for the Ask My Data entry state.
 *
 * Verbatim from EXPANSION_v4.md §T1-3. T1-1 ships these hardcoded; T1-later
 * swaps to a MiniMax-rotated pick from this list (the set stays the same,
 * the generator chooses which 6 to show per session).
 */
export const STARTER_PROMPTS: readonly string[] = [
  "Show me clients with declining engagement this quarter",
  "Which accounts moved into HNW tier this year?",
  "What life events did I miss in the last 30 days?",
  "Compare my pipeline to the same period last year",
  "Find clients with similar profiles to David Chen",
  "What's my worst-performing segment and why?",
] as const;
