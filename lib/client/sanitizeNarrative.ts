/**
 * lib/client/sanitizeNarrative.ts
 *
 * Belt-and-suspenders cleaner for LLM narrative text before we render it
 * inline. The system prompt already tells the model not to echo raw tool
 * output into its response, but during streaming it occasionally leaks a
 * CloudFront 403 HTML body, a stack trace, or a JSON error payload into
 * the prose — which then renders as a wall of `<!DOCTYPE>` nonsense next
 * to the answer.
 *
 * We strip:
 *  - HTML document bodies (anything starting with <!DOCTYPE or <HTML)
 *  - JSON error payloads the model quoted (keys like errorCode, sqlState)
 *  - "Error response:" style preambles when followed by a blob of markup
 *  - Obvious 403/404/500 status lines with HTML after them
 *
 * What we leave alone:
 *  - Normal prose, bullets, short code blocks
 *  - Paraphrased mentions of errors ("Data Cloud wasn't reachable") —
 *    those don't contain raw payloads so they pass through unchanged.
 */

const HTML_DOCUMENT = /<!DOCTYPE[\s\S]*?<\/HTML>/gi;
const HTML_HEAD_ONLY = /<HTML[\s\S]*?<\/HTML>/gi;
const HTML_BODY_ONLY = /<BODY[\s\S]*?<\/BODY>/gi;

// Status-prefixed HTML: "403 <!DOCTYPE …" up through the next blank line.
const STATUS_THEN_HTML =
  /\b(?:40[0-9]|50[0-9])\s+<[\s\S]*?(?=(?:\n\s*\n|\s*$))/gi;

// JSON error-payload blobs the model quoted inline. These typically look
// like:  [{"errorCode":"BAD_REQUEST","message":"…"}]  or a single object.
const JSON_ERROR_ARRAY =
  /\[\s*\{\s*"errorCode"\s*:[\s\S]*?\}\s*\]/g;
const JSON_ERROR_OBJECT =
  /\{\s*"errorCode"\s*:[\s\S]*?\}/g;
// More general: a fenced code block with tool error JSON.
const FENCED_ERROR =
  /```(?:json)?\s*\{\s*"(?:errorCode|errorMessage|sqlState|primaryMessage)"[\s\S]*?\}\s*```/g;

// "Error response:" / "Error:" followed by a blob of what looks like
// markup or JSON on the same or next line.
const PREFIXED_ERROR_DUMP =
  /(?:^|\n)[ \t]*(?:Error(?:\s+response)?|Response)\s*:\s*[\s\S]*?(?=\n\s*\n|\n[A-Z]|$)/gi;

// Stray HTML tags that slipped through (open/close pairs or singletons).
const STRAY_TAGS = /<\/?[A-Z][A-Z0-9]*(?:\s+[^>]*)?>/g;

// Chain-of-thought leakage. Claude 4.5 via Heroku Inference occasionally
// emits its internal reasoning wrapped in <think>…</think> or <thinking>…
// </thinking> tags into the text_delta stream. Those must never render.
// We handle both closed blocks and unclosed blocks (mid-stream, before the
// closing tag has arrived) — the unclosed form strips everything from the
// opening tag to end-of-buffer; when the closer eventually arrives we'll
// re-run this pass and get the clean block form.
const THINK_BLOCK = /<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi;
const THINK_OPEN_UNTERMINATED = /<think(?:ing)?\b[^>]*>[\s\S]*$/i;

export function sanitizeNarrative(raw: string): string {
  if (!raw) return raw;
  let s = raw;
  s = s.replace(THINK_BLOCK, "");
  s = s.replace(THINK_OPEN_UNTERMINATED, "");
  s = s.replace(HTML_DOCUMENT, "");
  s = s.replace(HTML_HEAD_ONLY, "");
  s = s.replace(HTML_BODY_ONLY, "");
  s = s.replace(STATUS_THEN_HTML, "");
  s = s.replace(FENCED_ERROR, "");
  s = s.replace(JSON_ERROR_ARRAY, "");
  s = s.replace(JSON_ERROR_OBJECT, "");
  s = s.replace(PREFIXED_ERROR_DUMP, "");
  s = s.replace(STRAY_TAGS, "");
  // Collapse whitespace left behind by the strips.
  s = s.replace(/\n{3,}/g, "\n\n");
  s = s.replace(/[ \t]+\n/g, "\n");
  return s.trim();
}

// Drafted-actions JSON leakage. The Ask Bar prompt asks the model to
// append a ```json block `{"actions":[...]}`. extractActions pulls the
// block out when it parses successfully, but during streaming the JSON
// is arriving character-by-character and can't parse yet — meanwhile
// it renders as text in the prose pane. Also, the Q1 demo showed the
// model sometimes omits the code fence entirely, yielding a raw
// `{"actions":[...` tail that extractActions' fallback catches only
// after the object closes. This helper is the safety net for the
// in-between moments: applied to the PROSE AFTER extractActions has
// already tried to pull out a valid block, so we never drop real
// actions — only the leftover text that couldn't be parsed yet.
//
// All patterns are anchored to end-of-string; we only ever clip the
// tail, never the middle.
const ACTIONS_TAIL_PATTERNS = [
  /```(?:json)?\s*\{\s*"actions"[\s\S]*$/i,
  /\{\s*"actions"\s*:\s*\[[\s\S]*$/,
  // Same treatment for the optional follow_up_suggestions tail block
  // appended by the Ask Bar response after the actions block.
  /```(?:json)?\s*\{\s*"follow_up_suggestions"[\s\S]*$/i,
  /\{\s*"follow_up_suggestions"\s*:\s*\[[\s\S]*$/,
];

export function stripActionsTail(prose: string): string {
  if (!prose) return prose;
  let s = prose;
  for (const re of ACTIONS_TAIL_PATTERNS) {
    s = s.replace(re, "");
  }
  return s.trimEnd();
}
