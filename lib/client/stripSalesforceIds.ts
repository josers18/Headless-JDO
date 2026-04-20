/**
 * Removes Salesforce wiring tokens that sometimes leak from tool output into
 * draft copy (FIX_PASS P1-3). Keeps natural language; strips machine keys only.
 */
export function stripDraftDisplayNoise(s: string): string {
  let t = s;
  t = t.replace(/\bsf_[A-Z0-9_]+\s*[:=]\s*[^\s]+/gi, "");
  t = t.replace(/\bWHO_ID\s*[:=]\s*[^\s]+/gi, "");
  t = t.replace(/\bWHAT_ID\s*[:=]\s*[^\s]+/gi, "");
  t = t.replace(/%0A/gi, " ");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t;
}
