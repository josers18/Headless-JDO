import { optionalEnv } from "@/lib/utils";
import { isLikelyMp3Buffer } from "@/lib/tts/mp3Guards";

/** Default voice: Rachel (public ElevenLabs voice id). Override via env. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export interface ElevenLabsTtsResult {
  ok: true;
  mp3: Buffer;
}

export interface ElevenLabsTtsError {
  ok: false;
  status: number;
  message: string;
}

/**
 * Calls ElevenLabs text-to-speech. Returns MP3 bytes on success.
 */
export async function synthesizeElevenLabsMp3(
  text: string
): Promise<ElevenLabsTtsResult | ElevenLabsTtsError> {
  const apiKey = optionalEnv("ELEVENLABS_API_KEY").trim();
  if (!apiKey) {
    return { ok: false, status: 503, message: "ELEVENLABS_API_KEY not configured" };
  }
  const voiceId = optionalEnv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID).trim();
  const outputFormat =
    optionalEnv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").trim() ||
    "mp3_44100_128";
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}?output_format=${encodeURIComponent(outputFormat)}`;
  const modelId = optionalEnv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5");
  const bodyPrimary = JSON.stringify({
    text,
    model_id: modelId,
    voice_settings: {
      stability: 0.45,
      similarity_boost: 0.72,
    },
  });
  let res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
    },
    body: bodyPrimary,
  });
  // why: some keys/models reject extra voice_settings fields; retry minimal body.
  if (!res.ok && res.status >= 400 && res.status < 500) {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, model_id: modelId }),
    });
  }
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    return {
      ok: false,
      status: res.status,
      message: errText || res.statusText,
    };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) {
    return { ok: false, status: 502, message: "TTS response too small" };
  }
  if (!isLikelyMp3Buffer(buf)) {
    return {
      ok: false,
      status: 502,
      message: "TTS response was not MP3 (unexpected format from upstream)",
    };
  }
  return { ok: true, mp3: buf };
}
