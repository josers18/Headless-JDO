"use client";

/**
 * Session-scoped cache for /api/client/[id] sheet content.
 *
 * The sheet's first open is a 6-tool fan-out + JSON synthesis (~10–15s).
 * The reasoning trail is a major demo asset, so we want it preserved. To
 * make subsequent opens instant, we snapshot the SSE stream's final
 * outputs (narrative JSON + reasoning trail steps + inference badge) into
 * sessionStorage on stream completion, keyed by clientId. Reopens read
 * from cache and render synchronously — no network call.
 *
 * Lifetime: sessionStorage = browser tab. Refresh clears, sign-out
 * clears. The persisted JSON is small (one client's 360°), so we don't
 * need a size-based eviction policy.
 */

import type { Step } from "@/components/horizon/ReasoningTrail";
import type { InferenceMeta } from "@/lib/client/useAgentStream";

const STORAGE_KEY = "horizon:clientDetailCache:v1";

export interface CachedClientDetail {
  clientId: string;
  /** Final narrative blob (the JSON the sheet parses). */
  narrative: string;
  /** Snapshot of the reasoning trail at stream completion. */
  steps: Step[];
  /** Inference meta badge state. */
  inferenceMeta: InferenceMeta | null;
  /** When this entry was written. ISO string. */
  cachedAt: string;
}

type Cache = Record<string, CachedClientDetail>;

function safeRead(): Cache {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Cache;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

function safeWrite(c: Cache): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function readCachedClientDetail(
  clientId: string
): CachedClientDetail | null {
  const c = safeRead();
  return c[clientId] ?? null;
}

export function writeCachedClientDetail(entry: CachedClientDetail): void {
  const c = safeRead();
  c[entry.clientId] = entry;
  safeWrite(c);
}

export function clearClientDetailCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
