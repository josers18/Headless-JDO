import Redis from "ioredis";
import { optionalEnv } from "@/lib/utils";

let redis: Redis | null | undefined;

/**
 * Shared Redis client for short-lived caches (TTS bytes). Returns null when
 * REDIS_URL is unset so local dev without Redis still boots.
 */
export function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const url = optionalEnv("REDIS_URL");
  if (!url) {
    redis = null;
    return null;
  }
  redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
  });
  return redis;
}
