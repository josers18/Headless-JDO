/**
 * lib/llm/tokenUsageCapture.ts — shared token-accounting helpers used by
 * BOTH OpenAI-compatible agent loops (lib/llm/heroku.ts and
 * lib/inference/heroku.ts). Centralized so the two stacks can't drift.
 *
 * Exact counts come from the upstream `usage` chunk (requires
 * stream_options.include_usage AND upstream support). When that chunk
 * never arrives, callers fall back to estimateTokens() and mark the
 * run `exact: false` so the UI can show an "≈ approximate" marker.
 */

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  /** false when any portion of the run was estimated rather than reported. */
  exact: boolean;
}

/** Crude chars-per-token heuristic (~4 chars/token). Rounds up; never negative. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Fold an upstream usage payload into a running accumulator, in place.
 * A non-null payload marks the run `exact`. Missing fields count as 0.
 */
export function foldUsageChunk(
  acc: { inputTokens: number; outputTokens: number; exact: boolean },
  usage:
    | { prompt_tokens?: number | null; completion_tokens?: number | null }
    | null
    | undefined
): void {
  if (!usage) return;
  acc.inputTokens += usage.prompt_tokens ?? 0;
  acc.outputTokens += usage.completion_tokens ?? 0;
  acc.exact = true;
}
