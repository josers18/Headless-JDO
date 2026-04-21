import { sameSalesforceRecordId } from "@/lib/salesforce/sameRecordId";

/** Resolve a display label for an Id even when cache keys differ by 15/18 form or casing. */
export function lookupEntityLabel(
  labels: Record<string, string>,
  id: string
): string | undefined {
  if (labels[id]) return labels[id];
  const c = id.replace(/[^0-9a-zA-Z]/g, "");
  for (const [k, v] of Object.entries(labels)) {
    if (sameSalesforceRecordId(c, k)) return v;
  }
  return undefined;
}
