/**
 * Pull likely Account / Contact style names from prose so we can SOQL-resolve
 * them when the model omitted entity_links (e.g. comma lists in suggested_action).
 */

const BLOCK = new Set(
  [
    "discovery stage",
    "qualification stage",
    "proposal stage",
    "salesforce crm",
    "data cloud",
    "tableau next",
    "this week",
    "last year",
    "next week",
    "high priority",
    "cash rewards",
    "payment processing",
    "positive pay",
    "corporate card",
    "merchant integration",
    "business succession",
    "portfolio performance",
    "insurance coverage",
    "rate change",
    "due april",
    "due today",
    "end day",
  ].map((s) => s.toLowerCase())
);

function isBlocked(phrase: string): boolean {
  const k = phrase.toLowerCase();
  if (BLOCK.has(k)) return true;
  if (k.length < 4) return true;
  return false;
}

export function extractNamesForProbing(text: string, max = 12): string[] {
  const found = new Set<string>();

  const normalized = text.replace(/\s*,\s*and\s+/gi, ", ");
  const pieces = normalized.split(/,|(?:\s+and\s+)/i);
  for (const piece of pieces) {
    let t = piece.trim();
    t = t.replace(/^(for|with|to|from|on|at|by)\s+/i, "");
    const head = t.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/);
    const cand = head?.[1]?.trim();
    if (cand && !isBlocked(cand)) found.add(cand);
  }

  const re = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  const matches = [...normalized.matchAll(re)];
  for (const mm of matches) {
    const cand = mm[1]?.trim();
    if (cand && !isBlocked(cand)) found.add(cand);
  }

  return [...found].slice(0, max);
}
