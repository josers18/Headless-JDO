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
    // Heroku Redis occasionally severs TLS sockets between commands —
    // especially from dev machines with NAT'd or roaming IPs. Retry
    // the command a few times before giving up, and reconnect on any
    // error that kills the socket.
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
    lazyConnect: true,
    // Auto-reconnect strategy: retry every 500ms up to 10s, then back
    // off exponentially. Prevents the "network socket disconnected"
    // from killing long-running refresh scripts.
    retryStrategy: (times) => Math.min(times * 500, 10_000),
    reconnectOnError: (err) => {
      const msg = err.message ?? "";
      return (
        /ECONNRESET|socket disconnected|read ETIMEDOUT|connect ETIMEDOUT|EPIPE/i.test(
          msg
        )
      );
    },
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    // Keep TCP alive so idle sockets aren't silently killed by NATs
    // or load balancers between commands.
    keepAlive: 30_000,
  });
  return redis;
}

/**
 * Short-lived Redis write for long-running scripts.
 *
 * The shared `getRedis()` client is fine for web routes (each request
 * holds the socket for milliseconds), but breaks for batch scripts
 * like scripts/refresh-*.ts — they connect, do 15–75s of MCP work
 * with the socket idle, then try to SET. By that point the TLS
 * socket has usually been severed by a middle box and ioredis's
 * reconnect logic can't re-handshake fast enough before the retry
 * budget runs out.
 *
 * Workaround: open a fresh connection right before the write, do
 * the SET, close. One-shot connections don't sit idle.
 *
 * Returns true on success, false on any failure (so callers can
 * decide whether to exit non-zero).
 */
export async function redisSetOnce(
  key: string,
  value: string,
  ttlSeconds: number
): Promise<{ ok: boolean; err?: string }> {
  const url = optionalEnv("REDIS_URL");
  if (!url) return { ok: false, err: "REDIS_URL missing" };
  const isTls = url.startsWith("rediss://");
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
    connectTimeout: 10_000,
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
  try {
    await client.connect();
    await client.set(key, value, "EX", ttlSeconds);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      err: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.quit().catch(() => {
      // If quit fails (socket already dead), force-disconnect silently.
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
    });
  }
}
