/**
 * Strips implementation jargon from Portfolio Pulse (and related) strings
 * before they render in the UI — C-2 / P-2.
 */

const REPLACEMENTS: Array<[RegExp, string]> = [
  [/Tableau(\s+Next)?/gi, "Analytics"],
  [/semantic\s+model(?:s|ing)?/gi, "benchmark data"],
  [/semantic\s+layer/gi, "benchmark layer"],
  // "governed book KPIs" / "governed KPIs" / "governed metric(s)" is a
  // phrase the model likes to reach for when tableau_next returns empty.
  // Collapse to plain English so a banker sees "portfolio KPIs" or
  // "portfolio metrics" and doesn't wonder what "governed" means here.
  [/governed\s+book\s+KPIs?/gi, "portfolio KPIs"],
  [/governed\s+KPIs?/gi, "portfolio KPIs"],
  [/governed\s+metrics?/gi, "portfolio metrics"],
  [/\bbook\s+KPIs?\b/gi, "portfolio KPIs"],
  [/MCP(\s+servers?|\s+tools?)?/gi, "connected systems"],
  [/\bSOQL\b/gi, "CRM query"],
  [/Data\s*360/gi, "unified data"],
  [/data_360/gi, "unified data"],
  [/tableau_next/gi, "analytics"],
  [/salesforce_crm/gi, "CRM"],
];

export function sanitizeBankerFacingPulseCopy(text: string): string {
  let out = text;
  for (const [re, rep] of REPLACEMENTS) {
    out = out.replace(re, rep);
  }
  return out;
}
