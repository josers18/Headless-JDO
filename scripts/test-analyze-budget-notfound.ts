/**
 * Regression test for the 2026-06-20 CSAT analyze bug: the turn-wide
 * once-budget for `analyze_data` was burned by ANY transport-successful
 * call — including Tableau "I couldn't find any field or metric for CSAT"
 * NON-answers. That suppressed the model's correct self-correction
 * (look up `list_semantic_model_metrics`, find the real metric "CSAT
 * Trends", re-call `analyze_data` with it) with "Duplicate analyze_data
 * suppressed", leaving the banker a not-found message and no chart.
 *
 * Fix: a not-found / unsatisfying analyze_data answer must NOT mark the
 * tool as consumed, so the corrective retry reaches Tableau. This file
 * inlines the exact `isUnsatisfyingAnalyzeAnswer` detector + the
 * consumed-budget gate shipped in lib/inference/analyzeAgent.ts. Keep in
 * sync with the source. Run:
 *   npx tsx scripts/test-analyze-budget-notfound.ts
 */

export {}; // module scope — avoid top-level `failures`/`check` collisions
// with the other no-import test scripts during the Next typecheck pass.

// ── Inlined from lib/inference/analyzeAgent.ts ───────────────────────
// A transport-successful analyze_data whose answer is a "couldn't find
// the field/metric" non-answer is a genuine failure that should not burn
// the once-budget. Patterns are intentionally discriminative: they key on
// "no/couldn't-find <field|metric|column|measure|dimension|data>" and
// "please specify which field" — phrasings that don't occur in a real
// data answer — so a legit answer containing "no data for March" is NOT
// misclassified.
function isUnsatisfyingAnalyzeAnswer(
  answer: string | null | undefined
): boolean {
  if (!answer) return false;
  const a = answer.toLowerCase();
  const NOT_FOUND_PATTERNS: RegExp[] = [
    /\b(could ?n'?t|can ?not|can'?t|could not|unable to) find\b[^.]{0,40}\b(field|metric|column|measure|dimension|data|kpi)\b/,
    /\bno (such |matching |relevant )?(field|metric|column|measure|dimension|kpi)\b[^.]{0,30}\b(for|named|called|matching|representing|that)\b/,
    /\b(do ?n'?t|do not) have (a |an |any )?(field|metric|column|measure|dimension|data|kpi)\b/,
    /\bplease specify which (field|metric|column|measure|value)\b/,
    /\b(field|metric|column|measure|dimension) (is |are )?not available\b/,
    /\bno data (is )?available\b/,
  ];
  return NOT_FOUND_PATTERNS.some((re) => re.test(a));
}

// Mirrors the consumed-budget gate at analyzeAgent.ts (post-fix). Returns
// the set of tool names that should be marked consumed for the turn.
function computeConsumed(
  results: Array<{ name: string; isError: boolean; analyzeAnswer?: string | null }>,
  turnWideOnceTools: Set<string>
): Set<string> {
  const consumed = new Set<string>();
  for (const r of results) {
    if (!r.isError && turnWideOnceTools.has(r.name)) {
      if (r.name === "analyze_data" && isUnsatisfyingAnalyzeAnswer(r.analyzeAnswer)) {
        continue; // not-found non-answer → do not burn the budget
      }
      consumed.add(r.name);
    }
  }
  return consumed;
}

let failures = 0;
function check(name: string, cond: boolean) {
  process.stdout.write(`  ${cond ? "✓" : "✗"} ${name}\n`);
  if (!cond) failures += 1;
}

const ONCE = new Set(["analyze_data"]);

// ── Detector: the exact CSAT not-found answer from the trail ─────────
{
  process.stdout.write("Detector: real Tableau not-found answers\n");
  check(
    "CSAT not-found (the bug's exact answer)",
    isUnsatisfyingAnalyzeAnswer(
      "I couldn't find any field or metric for CSAT (Customer Satisfaction Score) in your data. Please specify which field represents CSAT, or let me know if you want to use a different metric for this analysis."
    )
  );
  check(
    "could not find a metric",
    isUnsatisfyingAnalyzeAnswer("I could not find a metric named revenue in this model.")
  );
  check(
    "don't have data",
    isUnsatisfyingAnalyzeAnswer("I don't have data for that breakdown in this semantic model.")
  );
  check(
    "please specify which field",
    isUnsatisfyingAnalyzeAnswer("To answer that, please specify which field represents churn.")
  );
}

// ── Detector: real answers must NOT be flagged (no false positives) ──
{
  process.stdout.write("Detector: genuine answers pass through\n");
  check(
    "month breakdown is satisfying",
    !isUnsatisfyingAnalyzeAnswer(
      "CSAT Trends by month: Jan 73.2, Feb 73.55, Mar 71.4, Apr 72.88, May 64.83."
    )
  );
  check(
    "'no data for March' clause is NOT a not-found",
    !isUnsatisfyingAnalyzeAnswer(
      "Average CSAT was 73 in February, with no data for March; April recovered to 72.9."
    )
  );
  check(
    "overall average answer is satisfying",
    !isUnsatisfyingAnalyzeAnswer("The overall average CSAT Trends value is 70.15.")
  );
  check("empty answer is not 'unsatisfying'", !isUnsatisfyingAnalyzeAnswer(""));
  check("null answer is not 'unsatisfying'", !isUnsatisfyingAnalyzeAnswer(null));
}

// ── Budget gate: the bug scenario end-to-end ─────────────────────────
{
  process.stdout.write("Budget: not-found answer does NOT burn the once-budget\n");
  // iter1: analyze_data returns transport-OK but a not-found narrative.
  const iter1 = [
    {
      name: "analyze_data",
      isError: false,
      analyzeAnswer:
        "I couldn't find any field or metric for CSAT in your data. Please specify which field represents CSAT.",
    },
  ];
  const consumed1 = computeConsumed(iter1, ONCE);
  check(
    "analyze_data NOT consumed after not-found (retry allowed)",
    !consumed1.has("analyze_data")
  );
}

{
  process.stdout.write("Budget: useful answer DOES burn the once-budget (anti-hedge)\n");
  const iter1 = [
    {
      name: "analyze_data",
      isError: false,
      analyzeAnswer: "CSAT Trends by month: Jan 73.2, Feb 73.55, Mar 71.4.",
    },
  ];
  const consumed1 = computeConsumed(iter1, ONCE);
  check(
    "analyze_data consumed after a real answer (hedge blocked)",
    consumed1.has("analyze_data")
  );
}

{
  process.stdout.write("Budget: transport error never burns the budget\n");
  const iter1 = [
    { name: "analyze_data", isError: true, analyzeAnswer: null },
  ];
  const consumed1 = computeConsumed(iter1, ONCE);
  check("analyze_data NOT consumed on hard error", !consumed1.has("analyze_data"));
}

process.stdout.write(
  failures === 0 ? "\nALL PASS\n" : `\n${failures} CHECK(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
