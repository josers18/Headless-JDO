/**
 * OpenAI SDK clients for Horizon's inference backends.
 *
 * - heroku — Heroku Managed Inference (Claude 4.5 Sonnet), default.
 * - kimi    — Moonshot Kimi API (OpenAI-compatible). Opt-in per route via
 *             KIMI_ROUTES + KIMI_API_KEY to offload high-frequency pulls from
 *             the Heroku Inference TPM quota.
 */

import OpenAI from "openai";
import { optionalEnv, requireEnv } from "@/lib/utils";

export type InferenceBackend = "heroku" | "kimi";

let _herokuClient: OpenAI | null = null;
let _kimiClient: OpenAI | null = null;

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
  const key = optionalEnv("KIMI_API_KEY");
  if (!key?.length) {
    throw new Error(
      "KIMI_API_KEY is not set — cannot use Moonshot Kimi as the inference backend."
    );
  }
  if (!_kimiClient) {
    const base = optionalEnv("KIMI_BASE_URL", "https://api.moonshot.ai").replace(
      /\/$/,
      ""
    );
    _kimiClient = new OpenAI({
      apiKey: key,
      baseURL: `${base}/v1`,
    });
  }
  return _kimiClient;
}

export function modelIdFor(backend: InferenceBackend): string {
  if (backend === "heroku") {
    return process.env.INFERENCE_MODEL_ID ?? "claude-4-5-sonnet";
  }
  return optionalEnv("KIMI_MODEL_ID", "kimi-k2-turbo-preview");
}

/**
 * Pick Heroku Inference vs Moonshot Kimi for this agent run.
 *
 * - Explicit `inferenceBackend` wins (tests / emergency override).
 * - Otherwise, if `KIMI_API_KEY` is set and `routeHint` matches one entry in
 *   `KIMI_ROUTES` (comma-separated), use kimi.
 * - Default `KIMI_ROUTES` is `signals,pulse-strip` — high-frequency endpoints.
 */
export function resolveInferenceBackend(input: {
  inferenceBackend?: InferenceBackend;
  routeHint?: string;
}): InferenceBackend {
  if (input.inferenceBackend) return input.inferenceBackend;
  const key = optionalEnv("KIMI_API_KEY");
  if (!key?.length) return "heroku";
  const hint = input.routeHint?.trim();
  if (!hint) return "heroku";
  const routes = optionalEnv("KIMI_ROUTES", "signals,pulse-strip")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return routes.includes(hint) ? "kimi" : "heroku";
}
