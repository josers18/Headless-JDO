/**
 * scripts/verify-token-capture.ts — unit checks for the token capture
 * helper. Run: npx tsx scripts/verify-token-capture.ts
 */
export {};

import {
  estimateTokens,
  foldUsageChunk,
} from "../lib/llm/tokenUsageCapture";

let failures = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL: ${name}`);
    failures++;
  } else {
    console.log(`ok: ${name}`);
  }
}

// estimateTokens ~ chars/4, rounded up, never negative.
check("estimate empty is 0", estimateTokens("") === 0);
check("estimate 4 chars is 1", estimateTokens("abcd") === 1);
check("estimate 5 chars rounds up to 2", estimateTokens("abcde") === 2);

// foldUsageChunk: real usage marks exact and accumulates.
const acc = { inputTokens: 0, outputTokens: 0, exact: false };
foldUsageChunk(acc, { prompt_tokens: 10, completion_tokens: 5 });
check("fold accumulates input", acc.inputTokens === 10);
check("fold accumulates output", acc.outputTokens === 5);
check("fold marks exact", acc.exact === true);

// foldUsageChunk: null/undefined usage is a no-op, does not flip exact.
const acc2 = { inputTokens: 3, outputTokens: 2, exact: false };
foldUsageChunk(acc2, null);
foldUsageChunk(acc2, undefined);
check("fold null is no-op (input)", acc2.inputTokens === 3);
check("fold null keeps exact false", acc2.exact === false);

// foldUsageChunk: missing fields default to 0.
const acc3 = { inputTokens: 0, outputTokens: 0, exact: false };
foldUsageChunk(acc3, { prompt_tokens: 7 });
check("fold partial: input set", acc3.inputTokens === 7);
check("fold partial: output defaults 0", acc3.outputTokens === 0);
check("fold partial: still exact", acc3.exact === true);

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall token-capture checks passed");
