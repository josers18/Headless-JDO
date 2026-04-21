/**
 * Heuristic match for Salesforce Ids that may appear as 15- or 18-char forms
 * of the same record (REST returns 18; UI/tools often emit 15).
 */
export function sameSalesforceRecordId(a: string, b: string): boolean {
  const x = a.trim().replace(/[^0-9a-zA-Z]/g, "");
  const y = b.trim().replace(/[^0-9a-zA-Z]/g, "");
  if (x.length < 15 || y.length < 15) return false;
  if (x === y) return true;
  const x15 = x.length === 15 ? x : x.slice(0, 15);
  const y15 = y.length === 15 ? y : y.slice(0, 15);
  return x15.toLowerCase() === y15.toLowerCase();
}
