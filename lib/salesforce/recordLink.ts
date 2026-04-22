/**
 * Build Lightning record URLs from 15/18-char Ids. Prefix → object API name
 * is heuristic (covers common CRM objects).
 */

const PREFIX_TO_OBJECT: Record<string, string> = {
  "001": "Account",
  "002": "Note",
  "003": "Contact",
  "005": "User",
  "006": "Opportunity",
  "00Q": "Lead",
  "00T": "Task",
  "00U": "Event",
  "500": "Case",
  "701": "Campaign",
  "800": "Contract",
};

export function inferSalesforceObjectFromId(id: string): string | null {
  const clean = id.replace(/[^0-9a-zA-Z]/g, "");
  if (clean.length !== 15 && clean.length !== 18) return null;
  const prefix = clean.slice(0, 3);
  return PREFIX_TO_OBJECT[prefix] ?? null;
}

export function lightningRecordViewUrl(
  instanceUrl: string,
  id: string
): string | null {
  const obj = inferSalesforceObjectFromId(id);
  if (!obj) return null;
  const base = instanceUrl.replace(/\/+$/, "");
  return `${base}/lightning/r/${obj}/${id}/view`;
}

export type TextSegment =
  | { kind: "text"; value: string }
  | { kind: "id"; value: string };

/** Split plain text into alternating text and Salesforce Id tokens. */
export function segmentTextWithSalesforceIds(text: unknown): TextSegment[] {
  const s =
    typeof text === "string"
      ? text
      : text == null
        ? ""
        : String(text);
  const re = /\b([0-9a-zA-Z]{15}|[0-9a-zA-Z]{18})\b/g;
  const out: TextSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const id = m[1];
    if (!id) continue;
    if (m.index > last) {
      out.push({ kind: "text", value: s.slice(last, m.index) });
    }
    if (inferSalesforceObjectFromId(id)) {
      out.push({ kind: "id", value: id });
    } else {
      out.push({ kind: "text", value: id });
    }
    last = m.index + id.length;
  }
  if (last < s.length) {
    out.push({ kind: "text", value: s.slice(last) });
  }
  if (out.length === 0) out.push({ kind: "text", value: s });
  return out;
}

/** First Salesforce Id token in prose (for inferring `client_id` on arc rows). */
export function extractFirstSalesforceId(text: unknown): string | undefined {
  for (const seg of segmentTextWithSalesforceIds(text)) {
    if (seg.kind === "id") return seg.value;
  }
  return undefined;
}
