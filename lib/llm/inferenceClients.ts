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

/** Default HEROKU_INFERENCE_ONYX_ROUTES when env is unset; align with routeHint in API routes. */
export const DEFAULT_ONYX_ROUTE_LIST =
  "signals,pulse-strip,portfolio-pulse,priority,drafts,morning-brief,arc,insights,prep,client-detail,ghost-ask";

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
 * - Default routes: see `DEFAULT_ONYX_ROUTE_LIST` (most agent surfaces +
 *   insights/prep; Ask Bar stays primary unless ghost-ask).
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
    DEFAULT_ONYX_ROUTE_LIST
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return routes.includes(hint) ? "onyx" : "heroku";
}
