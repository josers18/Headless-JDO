/**
 * OpenAI SDK clients for Horizon's inference backends.
 *
 * - heroku — Primary Heroku Managed Inference (INFERENCE_URL + INFERENCE_KEY).
 * - onyx   — Second Heroku Inference deployment (HEROKU_INFERENCE_ONYX_*),
 *            same OpenAI-compatible /v1/chat/completions contract. Opt-in per
 *            route via HEROKU_INFERENCE_ONYX_ROUTES to offload TPM on hot paths.
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

/**
 * Pick primary Heroku Inference vs secondary Onyx deployment for this agent run.
 *
 * - Explicit `inferenceBackend` wins (tests / emergency override).
 * - Otherwise, if `HEROKU_INFERENCE_ONYX_URL` and `HEROKU_INFERENCE_ONYX_KEY`
 *   are set and `routeHint` matches `HEROKU_INFERENCE_ONYX_ROUTES`, use onyx.
 * - Default routes: `signals,pulse-strip,client-detail,ghost-ask`.
 */
export function resolveInferenceBackend(input: {
  inferenceBackend?: InferenceBackend;
  routeHint?: string;
}): InferenceBackend {
  if (input.inferenceBackend) return input.inferenceBackend;
  const url = optionalEnv("HEROKU_INFERENCE_ONYX_URL");
  const key = optionalEnv("HEROKU_INFERENCE_ONYX_KEY");
  if (!url?.length || !key?.length) return "heroku";
  const hint = input.routeHint?.trim();
  if (!hint) return "heroku";
  const routes = optionalEnv(
    "HEROKU_INFERENCE_ONYX_ROUTES",
    "signals,pulse-strip,client-detail,ghost-ask"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return routes.includes(hint) ? "onyx" : "heroku";
}
