import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureFreshToken } from "@/lib/salesforce/token";
import { synthesizeElevenLabsMp3 } from "@/lib/tts/elevenlabs";
import { getRedis } from "@/lib/redis";
import { log, correlationId } from "@/lib/log";
import { optionalEnv } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TTS_KEY_PREFIX = "tts:v1:";
const TTS_TTL_SEC = 60 * 60 * 24 * 7;
const MAX_CHARS = 12_000;

/**
 * POST /api/tts — authenticated narration for Morning Brief / Pulse.
 *
 * Body: `{ "text": string }`
 *
 * - When `ELEVENLABS_API_KEY` is set: returns `audio/mpeg` (cached in Redis
 *   by SHA-256 of the text when `REDIS_URL` is set).
 * - When unset: returns JSON `{ "mode": "fallback" }` with 200 so the client
 *   can use Web Speech without treating it as an error.
 */
export async function POST(req: NextRequest) {
  const cid = correlationId();
  const token = await ensureFreshToken();
  if (!token) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const text =
    typeof body === "object" &&
    body !== null &&
    "text" in body &&
    typeof (body as { text: unknown }).text === "string"
      ? (body as { text: string }).text.trim()
      : "";
  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json({ error: "text too long" }, { status: 400 });
  }

  if (!optionalEnv("ELEVENLABS_API_KEY")) {
    log.info("tts.fallback_no_key", { cid, len: text.length });
    return NextResponse.json({ mode: "fallback" as const }, { status: 200 });
  }

  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const cacheKey = `${TTS_KEY_PREFIX}${hash}`;

  const redis = getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const mp3 = Buffer.from(cached, "base64");
        log.info("tts.cache_hit", { cid, len: text.length });
        return new NextResponse(new Uint8Array(mp3), {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "private, max-age=604800",
            "X-TTS-Cache": "hit",
          },
        });
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
      { status: 200 }
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
    },
  });
}
