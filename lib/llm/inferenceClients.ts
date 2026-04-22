/**
 * OpenAI SDK clients for Horizon's inference backends.
 *
 * - heroku — Primary Heroku Managed Inference (Claude via INFERENCE_*).
 * - onyx   — Optional secondary deployment (HEROKU_INFERENCE_ONYX_*), e.g. Kimi,
 *            used only when primary fails — see lib/llm/provider.ts.
 */

import OpenAI from "openai";
import { optionalEnv, requireEnv } from "@/lib/utils";

export type InferenceBackend = "heroku" | "onyx";

let _herokuClient: OpenAI | null = null;
let _onyxClient: OpenAI | null = null;

export function openAiClientFor(backend: InferenceBackend): OpenAI {
  if (backend === "heroku") {
    if (!_herokuClient) {
      const base = requireEnv("INFERENCE_URL").replace(/\/$/, "");
      _herokuClient = new OpenAI({
        apiKey: requireEnv("INFERENCE_KEY"),
        baseURL: `${base}/v1`,
      });
    }
    return _herokuClient;
  }
  const key = optionalEnv("HEROKU_INFERENCE_ONYX_KEY");
  const urlRaw = optionalEnv("HEROKU_INFERENCE_ONYX_URL");
  if (!key?.length || !urlRaw?.length) {
    throw new Error(
      "HEROKU_INFERENCE_ONYX_KEY and HEROKU_INFERENCE_ONYX_URL must be set to use the onyx inference backend."
    );
  }
  if (!_onyxClient) {
    const base = urlRaw.replace(/\/$/, "");
    _onyxClient = new OpenAI({
      apiKey: key,
      baseURL: `${base}/v1`,
    });
  }
  return _onyxClient;
}

export function modelIdFor(backend: InferenceBackend): string {
  if (backend === "heroku") {
    return process.env.INFERENCE_MODEL_ID ?? "claude-4-5-sonnet";
  }
  return (
    optionalEnv("HEROKU_INFERENCE_ONYX_MODEL_ID") ||
    process.env.INFERENCE_MODEL_ID ||
    "claude-4-5-sonnet"
  );
}

/** True when Kimi/Onyx fallback can be attempted (both URL and key set). */
export function isOnyxInferenceConfigured(): boolean {
  const url = optionalEnv("HEROKU_INFERENCE_ONYX_URL");
  const key = optionalEnv("HEROKU_INFERENCE_ONYX_KEY");
  return Boolean(url?.trim() && key?.trim());
}

/**
 * Default model stack for this run. Route-based switching is disabled: all
 * surfaces use Claude (heroku) first; Onyx is only used on primary failure.
 * Explicit `inferenceBackend: "onyx"` forces Kimi-only (tests / ops).
 */
export function resolveInferenceBackend(input: {
  inferenceBackend?: InferenceBackend;
  routeHint?: string;
}): InferenceBackend {
  if (input.inferenceBackend) return input.inferenceBackend;
  return "heroku";
}
