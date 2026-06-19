/**
 * Regression test for the 2026-06-19 charts bug: analyze_data payloads
 * whose `troubleshootingInfo` blob pushes them past the 8KB cap used to
 * be sliced mid-JSON, breaking the whole-string JSON.parse in
 * extractAnalyzeAnswer / extractTableFallback → no dominant answer → no
 * table, no chart.
 *
 * This test rebuilds the transport-layer pipeline (slim → 8KB cap) and
 * the extractor's parse step, asserting the answer + data survive an
 * oversized payload. Pure functions, no network. Run:
 *   npx tsx scripts/test-analyze-payload-slim.ts
 */

// Re-declare the two pure functions under test by importing the module
// would pull in MCP SDK side-effects; instead we inline the exact logic
// shipped in lib/mcp/firstPartyTableauNext.ts (slimAnalyzePayload) and
// lib/inference/analyzeAgent.ts (extractAnalyzeAnswer parse step). Keep
// these in sync if the source changes.

function slimAnalyzePayload(text: string): string {
  if (!text || !text.includes("troubleshootingInfo")) return text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return text;
  }
  const obj = parsed as Record<string, unknown>;
  if (!("troubleshootingInfo" in obj)) return text;
  delete obj.troubleshootingInfo;
  return JSON.stringify(obj);
}

function extractAnswer(text: string): string | null {
  if (!text || text.length > 64_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  return typeof obj.answer === "string" ? obj.answer : null;
}

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures += 1;
    process.stdout.write(`  ✗ ${name}\n`);
  }
}

// ── Case 1: oversized payload (the real bug) ─────────────────────────
{
  const answer =
    "There are 41 months. Feb 2026: 73.55, Jan 2026: 73.2, Apr 2026: 72.88, May 2026: 64.83.";
  const oversized = JSON.stringify({
    answer,
    troubleshootingInfo: { irSpec: null, query: "x".repeat(20_000), rows: [] },
  });
  process.stdout.write(`Case 1: oversized payload (${oversized.length} chars)\n`);

  // OLD behavior: blind slice → parse throws → null
  const oldModelText = oversized.slice(0, 8_000);
  check("old path loses the answer (regression target)", extractAnswer(oldModelText) === null);

  // NEW behavior: slim → cap → parse succeeds
  const newModelText = slimAnalyzePayload(oversized).slice(0, 8_000);
  check("new path keeps the answer", extractAnswer(newModelText) === answer);
  check("new path strips troubleshootingInfo", !newModelText.includes("troubleshootingInfo"));
  check("new path is well-formed JSON", (() => { try { JSON.parse(newModelText); return true; } catch { return false; } })());
}

// ── Case 2: small payload with troubleshootingInfo — unaffected ──────
{
  const answer = "The average is 70.15.";
  const small = JSON.stringify({ answer, troubleshootingInfo: { query: "select 1" } });
  process.stdout.write(`Case 2: small payload (${small.length} chars)\n`);
  const out = slimAnalyzePayload(small).slice(0, 8_000);
  check("answer preserved", extractAnswer(out) === answer);
  check("blob still stripped (consistency + token savings)", !out.includes("troubleshootingInfo"));
}

// ── Case 3: payload without the blob — passthrough ───────────────────
{
  const answer = "No breakdown available.";
  const plain = JSON.stringify({ answer });
  process.stdout.write("Case 3: no troubleshootingInfo (passthrough)\n");
  const out = slimAnalyzePayload(plain);
  check("returned unchanged", out === plain);
  check("answer intact", extractAnswer(out.slice(0, 8_000)) === answer);
}

// ── Case 4: non-JSON text — passthrough, no throw ────────────────────
{
  const plain = "Tableau returned a plain sentence with troubleshootingInfo in it.";
  process.stdout.write("Case 4: non-JSON text (graceful passthrough)\n");
  const out = slimAnalyzePayload(plain);
  check("returned unchanged on parse failure", out === plain);
}

process.stdout.write(
  failures === 0
    ? "\nALL PASS\n"
    : `\n${failures} CHECK(S) FAILED\n`
);
process.exit(failures === 0 ? 0 : 1);
