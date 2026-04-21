/**
 * lib/safety/sanitize.ts — last-line defense against raw Salesforce Ids
 * leaking into prose fields.
 *
 * Every agent-produced string that is rendered as free prose (headline, why,
 * suggested_action, signoff, summary, rationale, title, body, context, etc.)
 * should pass through `sanitizeProse` immediately before rendering. The
 * sanitizer finds Salesforce-shaped Ids in prose and replaces them with a
 * neutral token — preserving surrounding punctuation — so nothing like
 * "003(aa0000000yCIAX)" or "sf_WHO_ID:..." ever reaches the banker.
 *
 * This is deliberately conservative: it only matches patterns that have the
 * shape of a Salesforce record Id, optionally wrapped in one of the known
 * parenthetical / prefix / id-field envelopes we've seen the model produce.
 *
 * `BriefRichText` already upgrades genuine Ids into links — so by the time
 * a string reaches the sanitizer, any Id the UI COULD have linked has
 * already been handled structurally. Anything still in raw prose is noise.
 */

import { log } from "@/lib/log";

// Salesforce Id envelopes we've observed in the wild:
//   - 003aa0000000yCIAX           (bare)
//   - 003(aa0000000yCIAX)         (prefix-paren split)
//   - sf_WHO_ID:0037000000ABCDE   (internal field leak)
//   - Contact 003aa…              (qualified)
//   - /003aa…                     (URL-ish)
// We strip them all down to a harmless "[unresolved]" marker unless they
// are clearly inside a code/link expression (backticks, markdown link, or
// plain-text URL) — those are handled upstream.

// Strict 15- or 18-character id shape with a known object-prefix family.
// We include a broad set of known prefixes so the sanitizer fires on
// anything that LOOKS like a Salesforce Id, even if it originated in a
// custom object (a0*, a1*, etc).
const KNOWN_PREFIXES = [
  "001", // Account
  "003", // Contact
  "005", // User
  "006", // Opportunity
  "00Q", // Lead
  "00T", // Task
  "00U", // Event
  "500", // Case
  "701", // Campaign
  "800", // Contract
];

// Match a bare id, case-sensitive on prefix, with the remainder 12 or 15
// alphanumerics.
const PREFIX_ALT = KNOWN_PREFIXES.join("|");
const BARE_ID = new RegExp(
  `\\b(?:${PREFIX_ALT})[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?\\b`,
  "g"
);

// Custom-object-ish ids (a0*, a1*, etc.) — 15 or 18 chars that start with a
// lowercase letter followed by a digit. Common for FS, wealth, loans.
const CUSTOM_ID = /\ba[0-9][A-Za-z0-9]{13}(?:[A-Za-z0-9]{3})?\b/g;

// Prefix-paren split: 003(aa0000000yCIAX)
const PREFIX_PAREN = new RegExp(
  `(?:${PREFIX_ALT})\\(([A-Za-z0-9]{12,15})\\)`,
  "g"
);

// sf_*_ID: leaks
const SF_FIELD_LEAK = /\bsf_[A-Za-z_]+_ID\s*:\s*[A-Za-z0-9]+/g;

// Qualified "Contact 003…" / "Account 001…" constructions
const QUALIFIED = new RegExp(
  `\\b(?:Contact|Account|Opportunity|Lead|Task|Event|Case|Campaign|Contract)\\s+((?:${PREFIX_ALT})[A-Za-z0-9]{12,15})\\b`,
  "g"
);

// URL-ish ids embedded in prose (leading slash without being in a markdown link)
const URLISH = new RegExp(
  `(?<![\\w(])/((?:${PREFIX_ALT})[A-Za-z0-9]{12,15})(?![\\w)])`,
  "g"
);

/**
 * Replace leaked Ids with a neutral token. Logs a warning (once per unique
 * leaked pattern per request) so we can see this happening in Heroku logs
 * and tighten prompts accordingly.
 */
export function sanitizeProse(input: unknown): string {
  if (typeof input !== "string") return typeof input === "number" ? String(input) : "";
  const raw = input;
  if (!raw) return raw;

  let out = raw;
  const hits: string[] = [];

  const record = (match: string) => hits.push(match);

  out = out.replace(PREFIX_PAREN, (m) => {
    record(m);
    return "[unresolved]";
  });
  out = out.replace(SF_FIELD_LEAK, (m) => {
    record(m);
    return "";
  });
  out = out.replace(QUALIFIED, (_m, id) => {
    record(`qualified:${id}`);
    return "a record";
  });
  out = out.replace(URLISH, (m) => {
    record(m);
    return "";
  });
  out = out.replace(BARE_ID, (m) => {
    record(m);
    return "[unresolved]";
  });
  out = out.replace(CUSTOM_ID, (m) => {
    record(m);
    return "[unresolved]";
  });

  // Collapse doubled spaces and any ", ," that the replacements left.
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .trim();

  if (hits.length > 0) {
    log.warn("prose_sanitizer_fired", {
      count: hits.length,
      sample: hits.slice(0, 3),
    });
  }

  return out;
}

/**
 * Convenience — run `sanitizeProse` across every known prose field of an
 * arbitrary object (shallow). Leaves non-prose fields (arrays, objects,
 * known structured id fields like client_id, target_id) untouched.
 */
const PROSE_FIELDS = new Set([
  "headline",
  "why",
  "suggested_action",
  "signoff",
  "summary",
  "rationale",
  "title",
  "body",
  "context",
  "text",
  "subtitle",
  "message",
  "note",
  "description",
]);

export function sanitizeObjectProse<T extends Record<string, unknown>>(obj: T): T {
  const next: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === "string" && PROSE_FIELDS.has(k)) {
      next[k] = sanitizeProse(v);
    }
  }
  return next as T;
}

/** True when `s` contains a Salesforce-shaped Id that would be sanitized. */
export function containsRawSalesforceId(s: string): boolean {
  if (!s) return false;
  return (
    BARE_ID.test(s) ||
    CUSTOM_ID.test(s) ||
    PREFIX_PAREN.test(s) ||
    SF_FIELD_LEAK.test(s) ||
    QUALIFIED.test(s) ||
    URLISH.test(s)
  );
}

/**
 * Strip ONLY the weird wrapper forms ("003(aa0…)", "sf_WHO_ID:…",
 * "Contact 003…", "/003…") — leave bare Ids in place so BriefRichText can
 * resolve them to names / Lightning links. Use this as the in-render safety
 * net; use `sanitizeProse` at the API boundary (stricter, strips bare Ids
 * too) to be belt-and-suspenders.
 */
export function sanitizeProseLite(input: unknown): string {
  if (typeof input !== "string") return typeof input === "number" ? String(input) : "";
  let out = input;
  out = out.replace(PREFIX_PAREN, "[unresolved]");
  out = out.replace(SF_FIELD_LEAK, "");
  out = out.replace(QUALIFIED, "a record");
  out = out.replace(URLISH, "");
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s+\./g, ".")
    .trim();
  return out;
}
