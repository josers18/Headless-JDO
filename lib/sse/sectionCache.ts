/**
 * lib/sse/sectionCache.ts — server-side daily cache for SSE section routes.
 *
 * Wraps the expensive Today section routes (/api/brief, /api/priority,
 * /api/pulse, /api/drafts, /api/arc) so the agent loop only runs ONCE
 * per banker per local-day. Subsequent loads replay the captured SSE
 * event sequence from Redis — same events the client would see from a
 * live run, so the reasoning trail and inference badge survive.
 *
 * Why not Postgres briefings table? Postgres holds the SHAPE (final
 * payload), not the streamed events. A cache hit needs to feed
 * useAgentStream the same sequence it parses live — text_delta chunks,
 * tool_use/tool_result rows, inference_meta — so JSON-shape persistence
 * doesn't help. Redis JSON blob of the event array is the right fit.
 *
 * Refresh: callers can pass `bypass: true` (typically driven by a
 * `?refresh=1` query param) to skip the read and overwrite on
 * completion. Caller is responsible for guarding the bypass behind
 * banker-initiated UI (refresh button) — no automatic invalidation.
 *
 * Failure mode: any Redis error degrades to live-fetch behavior. Never
 * blocks the request.
 */

import { getRedis } from "@/lib/redis";
import type { SseEvent } from "@/lib/sse/stream";
import { log } from "@/lib/log";

// Cache schema version. Bump whenever the captured SSE event protocol
// changes in a way that older cached sequences can't satisfy — a bump
// invalidates every stale daily entry on deploy (old keys simply go
// unread and TTL out) instead of waiting for local-midnight rollover.
// v2 (2026-06-19): events now carry iteration_usage + resultTokens for
// the per-step reasoning-trail token counts; v1 captures lack them.
const KEY_PREFIX = "horizon:section:v2";
/** 36h. Survives one missed local-day boundary so morning loads stay warm. */
const DEFAULT_TTL_SECONDS = 36 * 3600;

/** Events we exclude from replay because they're not deterministic. */
const NON_REPLAYABLE_TYPES = new Set<SseEvent["type"]>([
  "thread_snapshot", // ask-thread-only, irrelevant on Today routes
]);

export interface CachedSection {
  /** ISO8601 timestamp of original capture. */
  cachedAt: string;
  /** Banker's local YYYY-MM-DD when captured (for stale-day comparison). */
  localDay: string;
  /** Captured SSE event sequence to replay on hit. */
  events: SseEvent[];
}

export type LocalDayProvider = () => string;

/**
 * Build the per-banker, per-day cache key. The key includes the local
 * day from the caller's TZ provider so the cache rolls over at the
 * banker's midnight, not UTC midnight.
 */
function buildKey(
  route: string,
  bankerUserId: string,
  localDay: string
): string {
  return `${KEY_PREFIX}:${route}:${bankerUserId}:${localDay}`;
}

export async function readCachedSection(
  route: string,
  bankerUserId: string,
  localDay: string
): Promise<CachedSection | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const key = buildKey(route, bankerUserId, localDay);
    const raw = await redis.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedSection;
    if (
      !parsed ||
      typeof parsed.cachedAt !== "string" ||
      !Array.isArray(parsed.events)
    ) {
      return null;
    }
    return parsed;
  } catch (err) {
    log.warn("section_cache.read_error", {
      route,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Persist a captured event sequence. Filters out events the replay
 * path can't safely re-emit and trims `text_delta` runs into one
 * concatenated string per natural boundary so replay is fast.
 */
export async function writeCachedSection(
  route: string,
  bankerUserId: string,
  localDay: string,
  events: SseEvent[]
): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  const filtered = events.filter((e) => !NON_REPLAYABLE_TYPES.has(e.type));
  // Coalesce contiguous text_delta runs to keep the blob small. The
  // client's hook concatenates them back to the same string, so
  // collapsing on write changes nothing semantically.
  const coalesced: SseEvent[] = [];
  for (const e of filtered) {
    const last = coalesced[coalesced.length - 1];
    if (
      e.type === "text_delta" &&
      last &&
      last.type === "text_delta"
    ) {
      last.text += e.text;
    } else {
      coalesced.push(e);
    }
  }
  const payload: CachedSection = {
    cachedAt: new Date().toISOString(),
    localDay,
    events: coalesced,
  };
  try {
    const key = buildKey(route, bankerUserId, localDay);
    await redis.set(key, JSON.stringify(payload), "EX", DEFAULT_TTL_SECONDS);
    log.info("section_cache.write", {
      route,
      localDay,
      events: coalesced.length,
    });
  } catch (err) {
    log.warn("section_cache.write_error", {
      route,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Format a Date as YYYY-MM-DD in the given IANA timezone. Used to
 * derive the banker-local day key. Falls back to ISO date if Intl is
 * unavailable for some reason.
 */
export function localDayInTz(now: Date, tz: string): string {
  try {
    // en-CA gives YYYY-MM-DD natively.
    return now.toLocaleDateString("en-CA", { timeZone: tz });
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
