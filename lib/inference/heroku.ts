/**
 * Isolated Heroku Managed Inference client for the v1.1 expansion.
 *
 * Used ONLY by Ask My Data (`/ask`) and Analyze (`/analyze`). The Today
 * surface (`/`) continues to use `lib/llm/heroku.ts` + `lib/llm/provider.ts`
 * — this file deliberately shares nothing with that path so cost routing
 * (cheap Kimi / MiniMax here, hero Claude on Today) stays clean.
 *
 * Two tiers:
 *   - "reasoning" → Kimi K2 Thinking via HEROKU_INFERENCE_ONYX_*
 *                    (primary agent turns, multi-step tool use)
 *   - "short"     → MiniMax M2 via HEROKU_INFERENCE_IVORY_*
 *                    (thread titles, follow-ups, chart selection, etc.)
 *
 * Both models speak the OpenAI-compatible /v1/chat/completions wrapper.
 *
 * Streaming output is normalized to a simple event shape so consumers
 * don't have to know the underlying SDK. See {@link HerokuInferenceEvent}.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionToolChoiceOption,
} from "openai/resources/chat/completions";

export type HerokuInferenceTier = "reasoning" | "short";

/** Normalized streaming event shape (Q-T0-3-b option A). */
export type HerokuInferenceEvent =
  | { type: "token"; text: string }
  | {
      type: "tool_call";
      // Streaming tool_call deltas: `id` and `name` may appear across
      // chunks, `input` is accumulated partial-JSON until `done` is seen
      // for that call index.
      index: number;
      id?: string;
      name?: string;
      inputDelta?: string;
    }
  | {
      type: "tool_call_complete";
      index: number;
      id: string;
      name: string;
      input: unknown;
    }
  | { type: "done"; stopReason: string | null };

export type HerokuInferenceParams = {
  tier: HerokuInferenceTier;
  system?: string;
  messages: ChatCompletionMessageParam[];
  tools?: ChatCompletionTool[];
  toolChoice?: ChatCompletionToolChoiceOption;
  /**
   * When set, the underlying request asks for JSON mode. Keep the prompt
   * disciplined — OpenAI-compatible JSON mode still expects the model to
   * be told it must return JSON.
   */
  responseFormat?: { type: "json_object" };
  temperature?: number;
  maxTokens?: number;
  /** Aborts the underlying fetch. */
  signal?: AbortSignal;
};

export type HerokuInferenceResult = {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  stopReason: string | null;
  tier: HerokuInferenceTier;
  modelId: string;
};

// ─── Client factories ─────────────────────────────────────────────────────

const _clients: Partial<Record<HerokuInferenceTier, OpenAI>> = {};

function clientFor(tier: HerokuInferenceTier): {
  client: OpenAI;
  modelId: string;
} {
  const cfg = resolveTierConfig(tier);
  if (!_clients[tier]) {
    const base = cfg.url.replace(/\/$/, "");
    _clients[tier] = new OpenAI({
      apiKey: cfg.key,
      baseURL: `${base}/v1`,
    });
  }
  return { client: _clients[tier]!, modelId: cfg.modelId };
}

function resolveTierConfig(tier: HerokuInferenceTier): {
  url: string;
  key: string;
  modelId: string;
} {
  if (tier === "reasoning") {
    return {
      url: mustEnv("HEROKU_INFERENCE_ONYX_URL"),
      key: mustEnv("HEROKU_INFERENCE_ONYX_KEY"),
      modelId: mustEnv("HEROKU_INFERENCE_ONYX_MODEL_ID"),
    };
  }
  return {
    url: mustEnv("HEROKU_INFERENCE_IVORY_URL"),
    key: mustEnv("HEROKU_INFERENCE_IVORY_KEY"),
    modelId: mustEnv("HEROKU_INFERENCE_IVORY_MODEL_ID"),
  };
}

function mustEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(
      `${name} is not set. Add it to .env (see .env.example). ` +
        `v1.1-expansion (T0-3) requires Kimi (ONYX) + MiniMax (IVORY) envs.`
    );
  }
  return v.trim();
}

/** True when the tier's required env vars are populated. */
export function isTierConfigured(tier: HerokuInferenceTier): boolean {
  try {
    resolveTierConfig(tier);
    return true;
  } catch {
    return false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * One-shot completion. Internally uses streaming to get token-level
 * deltas and tool-call assembly, but buffers everything into a single
 * result. Prefer {@link streamHeroku} when the caller needs to forward
 * tokens to the UI as they arrive.
 */
export async function inferHeroku(
  params: HerokuInferenceParams
): Promise<HerokuInferenceResult> {
  let text = "";
  const tools = new Map<
    number,
    { id: string; name: string; argsJson: string }
  >();
  let stopReason: string | null = null;

  for await (const ev of streamHeroku(params)) {
    if (ev.type === "token") {
      text += ev.text;
    } else if (ev.type === "tool_call") {
      const prev = tools.get(ev.index) ?? { id: "", name: "", argsJson: "" };
      if (ev.id) prev.id = ev.id;
      if (ev.name) prev.name = ev.name;
      if (ev.inputDelta) prev.argsJson += ev.inputDelta;
      tools.set(ev.index, prev);
    } else if (ev.type === "tool_call_complete") {
      tools.set(ev.index, {
        id: ev.id,
        name: ev.name,
        argsJson: JSON.stringify(ev.input ?? {}),
      });
    } else if (ev.type === "done") {
      stopReason = ev.stopReason;
    }
  }

  const toolCalls = [...tools.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, v]) => v)
    .filter((v) => v.name)
    .map((v) => ({
      id: v.id,
      name: v.name,
      input: safeParseJson(v.argsJson),
    }));

  const { modelId } = clientFor(params.tier);
  return {
    text,
    toolCalls,
    stopReason,
    tier: params.tier,
    modelId,
  };
}

/**
 * Streaming variant. Yields normalized events as they arrive from the
 * upstream SDK. Callers typically forward `token` events straight to an
 * SSE stream and accumulate `tool_call` deltas for dispatch.
 */
export async function* streamHeroku(
  params: HerokuInferenceParams
): AsyncGenerator<HerokuInferenceEvent, void, unknown> {
  const { client, modelId } = clientFor(params.tier);

  const messages: ChatCompletionMessageParam[] = params.system
    ? [{ role: "system", content: params.system }, ...params.messages]
    : params.messages;

  const stream = await client.chat.completions.create(
    {
      model: modelId,
      messages,
      stream: true,
      ...(params.tools && params.tools.length > 0
        ? { tools: params.tools, tool_choice: params.toolChoice ?? "auto" }
        : {}),
      ...(params.responseFormat
        ? { response_format: params.responseFormat }
        : {}),
      ...(typeof params.temperature === "number"
        ? { temperature: params.temperature }
        : {}),
      ...(typeof params.maxTokens === "number"
        ? { max_tokens: params.maxTokens }
        : {}),
    },
    params.signal ? { signal: params.signal } : undefined
  );

  // Track in-flight tool calls so we can emit `tool_call_complete` once
  // the upstream finish_reason confirms the model is done emitting.
  const inflight = new Map<
    number,
    { id: string; name: string; argsJson: string }
  >();
  let stopReason: string | null = null;

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta;

    if (
      delta &&
      typeof delta.content === "string" &&
      delta.content.length > 0
    ) {
      yield { type: "token", text: delta.content };
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        const prev = inflight.get(idx) ?? { id: "", name: "", argsJson: "" };
        if (tc.id) prev.id = tc.id;
        if (tc.function?.name) prev.name = tc.function.name;
        if (tc.function?.arguments) prev.argsJson += tc.function.arguments;
        inflight.set(idx, prev);
        yield {
          type: "tool_call",
          index: idx,
          id: tc.id ?? undefined,
          name: tc.function?.name ?? undefined,
          inputDelta: tc.function?.arguments ?? undefined,
        };
      }
    }

    if (choice.finish_reason) {
      stopReason = choice.finish_reason;
    }
  }

  // On finish, emit a completion marker for each buffered tool call
  // so callers don't have to reassemble partial JSON themselves.
  for (const [idx, v] of [...inflight.entries()].sort(([a], [b]) => a - b)) {
    if (!v.name) continue;
    yield {
      type: "tool_call_complete",
      index: idx,
      id: v.id,
      name: v.name,
      input: safeParseJson(v.argsJson),
    };
  }

  yield { type: "done", stopReason };
  // Avoid "modelId was defined but unused" false-negative — it's surfaced
  // on the caller via inferHeroku's result, not through the stream.
  void modelId;
}

function safeParseJson(s: string): unknown {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: s };
  }
}
