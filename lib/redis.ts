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
  // Heroku Redis uses rediss:// with a self-signed cert chain. ioredis's
  // default tls.createSecureContext() rejects self-signed certs, so we
  // relax the check ONLY when the URL is rediss://. Plain redis:// (local
  // dev) is unaffected.
  const isTls = url.startsWith("rediss://");
  redis = new Redis(url, {
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
    lazyConnect: true,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
  return redis;
}
