/**
 * Deduped client-side cache for Id → display label (Name / Subject) via
 * `/api/sf/labels`. Multiple TextWithSalesforceIds instances share one fetch.
 */

const labelCache: Record<string, string> = {};
const inflight = new Map<string, Promise<void>>();

function sortedKey(ids: string[]): string {
  return [...ids].sort().join("|");
}

async function fetchLabelsFor(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const res = await fetch("/api/sf/labels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return;
  const body = (await res.json()) as { labels?: Record<string, string> };
  const batch = body.labels ?? {};
  for (const [k, v] of Object.entries(batch)) {
    if (typeof v === "string" && v.trim()) labelCache[k] = v.trim();
  }
}

/**
 * Ensures labels for the given Ids are cached, then returns a map id → label
 * (falls back to id when unknown).
 */
export async function resolveSfLabels(ids: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.map((s) => s.trim()).filter(Boolean))].slice(0, 40);
  const missing = unique.filter((id) => labelCache[id] === undefined);
  if (missing.length > 0) {
    const key = sortedKey(missing);
    let p = inflight.get(key);
    if (!p) {
      p = fetchLabelsFor(missing).finally(() => {
        inflight.delete(key);
      });
      inflight.set(key, p);
    }
    await p;
  }
  return Object.fromEntries(unique.map((id) => [id, labelCache[id] ?? id]));
}
