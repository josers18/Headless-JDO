import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { synthesizeElevenLabsMp3 } from "@/lib/tts/elevenlabs";
import { getRedis } from "@/lib/redis";
import { isLikelyMp3Buffer } from "@/lib/tts/mp3Guards";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTS_KEY_PREFIX = "tts:v1:";
const TTS_TTL_SEC = 60 * 60 * 24 * 7;
const MAX_CHARS = 12_000;

/** Single-dyno burst guard when SF auth is disabled for filming. */
const RL_WINDOW_MS = 60_000;
const RL_MAX = 50;
const rlHits = new Map<string, number[]>();

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

function allowRate(ip: string): boolean {
  const now = Date.now();
  const arr = (rlHits.get(ip) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  arr.push(now);
  rlHits.set(ip, arr);
  return arr.length <= RL_MAX;
}

/**
 * POST /api/tts — narration for Morning Brief / Pulse.
 *
 * Body: `{ "text": string }`
 *
 * Auth: by default requires Salesforce session cookie (same as other APIs).
 * Set `TTS_REQUIRE_SF_AUTH=0` on Heroku only for controlled demos if the SF
 * cookie is not reaching this route; pair with a short rate limit (in-memory).
 *
 * Response header `X-TTS-Result` is always set for debugging in Network:
 * `mp3` | `fallback_no_key` | `fallback_unauth` | `fallback_upstream` |
 * `fallback_rate` | `fallback_bad_cache`
 */
export async function POST(req: NextRequest) {
  const cid = correlationId();
  const ip = clientIp(req);
  const requireSfAuth = optionalEnv("TTS_REQUIRE_SF_AUTH", "1") !== "0";

  if (requireSfAuth) {
    const token = await ensureFreshToken();
    if (!token) {
      log.info("tts.unauth", { cid, ip });
      return NextResponse.json(
        { error: "unauthenticated", mode: "fallback" as const },
        {
          status: 401,
          headers: { "X-TTS-Result": "fallback_unauth" },
        }
      );
    }
  } else if (!allowRate(ip)) {
    log.warn("tts.rate_limited", { cid, ip });
    return NextResponse.json(
      { mode: "fallback" as const, reason: "rate_limited" },
      { status: 200, headers: { "X-TTS-Result": "fallback_rate" } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid json" },
      { status: 400, headers: { "X-TTS-Result": "error_bad_json" } }
    );
  }
  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  if (!text) {
    return NextResponse.json(
      { error: "text required" },
      { status: 400, headers: { "X-TTS-Result": "error_no_text" } }
    );
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      { error: "text too long" },
      { status: 400, headers: { "X-TTS-Result": "error_too_long" } }
    );
  }

  if (!optionalEnv("ELEVENLABS_API_KEY").trim()) {
    log.info("tts.fallback_no_key", { cid, len: text.length });
    return NextResponse.json(
      { mode: "fallback" as const },
      { status: 200, headers: { "X-TTS-Result": "fallback_no_key" } }
    );
  }

  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const cacheKey = `${TTS_KEY_PREFIX}${hash}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const mp3 = Buffer.from(cached, "base64");
        if (mp3.length >= 64 && isLikelyMp3Buffer(mp3)) {
          log.info("tts.cache_hit", { cid, len: text.length });
          return new NextResponse(new Uint8Array(mp3), {
            status: 200,
            headers: {
              "Content-Type": "audio/mpeg",
              "Cache-Control": "private, max-age=604800",
              "X-TTS-Cache": "hit",
              "X-TTS-Result": "mp3",
            },
          });
        }
        await redis.del(cacheKey).catch(() => {});
        log.warn("tts.cache_invalid_evicted", { cid, len: mp3.length });
      }
    } catch {
      // why: Redis optional; continue to upstream synth
    }
  }

  const synth = await synthesizeElevenLabsMp3(text);
  if (!synth.ok) {
    log.warn("tts.upstream_fail", {
      cid,
      status: synth.status,
      preview: synth.message.slice(0, 80),
    });
    return NextResponse.json(
      { mode: "fallback" as const, reason: "upstream_error" },
      {
        status: 200,
        headers: { "X-TTS-Result": "fallback_upstream" },
      }
    );
  }

  if (redis) {
    try {
      await redis.setex(
        cacheKey,
        TTS_TTL_SEC,
        synth.mp3.toString("base64")
      );
    } catch {
      // why: cache write failure should not block playback
    }
  }

  log.info("tts.synth_ok", { cid, len: text.length, bytes: synth.mp3.length });
  return new NextResponse(new Uint8Array(synth.mp3), {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "private, max-age=604800",
      "X-TTS-Cache": "miss",
      "X-TTS-Result": "mp3",
    },
  });
}
