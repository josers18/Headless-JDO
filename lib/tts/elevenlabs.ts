import { optionalEnv } from "@/lib/utils";
import { isLikelyMp3Buffer } from "@/lib/tts/mp3Guards";

/** Default voice: Rachel (library preset). Override with your cloned voice id. */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/** Docs default; turbo is often plan-gated — multilingual v2 is the safe baseline. */
const FALLBACK_MODEL = "eleven_multilingual_v2";

export interface ElevenLabsTtsResult {
  ok: true;
  mp3: Buffer;
}

export interface ElevenLabsTtsError {
  ok: false;
  status: number;
  message: string;
}

function buildUrl(voiceId: string, outputFormat: string, base: string): string {
  return `${base}/v1/text-to-speech/${encodeURIComponent(
    voiceId
  )}?output_format=${encodeURIComponent(outputFormat)}`;
}

async function postTts(
  url: string,
  apiKey: string,
  body: string
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/octet-stream, audio/mpeg;q=0.9, */*;q=0.8",
      "Content-Type": "application/json",
    },
    body,
  });
}

/**
 * Calls ElevenLabs text-to-speech. Returns MP3 bytes on success.
 * Retries with safer model / bitrate when the plan rejects turbo or high kbps.
 */
export async function synthesizeElevenLabsMp3(
  text: string
): Promise<ElevenLabsTtsResult | ElevenLabsTtsError> {
  const apiKey = optionalEnv("ELEVENLABS_API_KEY").trim();
  if (!apiKey) {
    return { ok: false, status: 503, message: "ELEVENLABS_API_KEY not configured" };
  }
  const voiceId = optionalEnv("ELEVENLABS_VOICE_ID", DEFAULT_VOICE_ID).trim();
  const base = optionalEnv("ELEVENLABS_API_BASE", "https://api.elevenlabs.io")
    .trim()
    .replace(/\/$/, "");
  const preferredModel =
    optionalEnv("ELEVENLABS_MODEL_ID", FALLBACK_MODEL).trim() ||
    FALLBACK_MODEL;
  const preferredFormat =
    optionalEnv("ELEVENLABS_OUTPUT_FORMAT", "mp3_44100_128").trim() ||
    "mp3_44100_128";

  type Attempt = { label: string; format: string; modelId: string };
  const attempts: Attempt[] = [
    {
      label: `${preferredModel}@${preferredFormat}`,
      format: preferredFormat,
      modelId: preferredModel,
    },
  ];
  if (preferredModel !== FALLBACK_MODEL) {
    attempts.push({
      label: `${FALLBACK_MODEL}@${preferredFormat}`,
      format: preferredFormat,
      modelId: FALLBACK_MODEL,
    });
  }
  attempts.push({
    label: `${FALLBACK_MODEL}@mp3_22050_32`,
    format: "mp3_22050_32",
    modelId: FALLBACK_MODEL,
  });

  let lastErr = "no attempts";
  let lastStatus = 0;

  for (const a of attempts) {
    const url = buildUrl(voiceId, a.format, base);
    const minimal = JSON.stringify({ text, model_id: a.modelId });
    let res = await postTts(url, apiKey, minimal);
    if (!res.ok && res.status >= 400 && res.status < 500) {
      const withSettings = JSON.stringify({
        text,
        model_id: a.modelId,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      });
      res = await postTts(url, apiKey, withSettings);
    }
    if (!res.ok) {
      const errText = (await res.text()).slice(0, 400);
      lastStatus = res.status;
      lastErr = `[${a.label}] HTTP ${res.status}: ${errText}`;
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) {
      lastStatus = 502;
      lastErr = `[${a.label}] body too small (${buf.length})`;
      continue;
    }
    if (!isLikelyMp3Buffer(buf)) {
      lastStatus = 502;
      const head = buf.subarray(0, 40).toString("utf8").replace(/\s+/g, " ");
      lastErr = `[${a.label}] not MP3 magic (head=${head})`;
      continue;
    }
    return { ok: true, mp3: buf };
  }

  return {
    ok: false,
    status: lastStatus || 502,
    message: lastErr,
  };
}
