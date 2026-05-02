#!/usr/bin/env tsx
/**
 * T0-3 smoke test — hits Kimi K2 Thinking + MiniMax M2 via Heroku Managed
 * Inference and validates both basic streaming and tool-call parsing.
 *
 * Usage:
 *   npx tsx scripts/smoke-heroku-inference.ts
 *
 * Requires (in .env):
 *   HEROKU_INFERENCE_ONYX_URL / _KEY / _MODEL_ID    (Kimi)
 *   HEROKU_INFERENCE_IVORY_URL / _KEY / _MODEL_ID   (MiniMax)
 *
 * Exits non-zero on the first failure.
 */

// Env loading is handled by tsx's --env-file flag (see package.json
// `smoke:heroku-inference` script). Running the file directly without
// the flag will fail with "X is not set" from mustEnv.

import {
  inferHeroku,
  isTierConfigured,
  streamHeroku,
  type HerokuInferenceTier,
} from "../lib/inference/heroku";

type TestResult = { name: string; ok: boolean; detail?: string };

async function testReasoningOneShot(): Promise<TestResult> {
  const name = "Kimi (reasoning) — one-shot completion";
  try {
    const res = await inferHeroku({
      tier: "reasoning",
      messages: [
        {
          role: "user",
          content:
            "In one short sentence, what is relationship banking? End with a period.",
        },
      ],
      // Kimi is a reasoning model — a tight max_tokens budget gets fully
      // consumed by hidden thinking before any content tokens are emitted.
      // 2000 leaves ample headroom for a one-sentence answer.
      maxTokens: 2000,
    });
    if (!res.text || res.text.length < 5) {
      return { name, ok: false, detail: `empty response (stop=${res.stopReason})` };
    }
    return {
      name,
      ok: true,
      detail: `model=${res.modelId} stop=${res.stopReason} chars=${res.text.length}`,
    };
  } catch (e) {
    return { name, ok: false, detail: String(e instanceof Error ? e.message : e) };
  }
}

async function testShortOneShot(): Promise<TestResult> {
  const name = "MiniMax (short) — one-shot completion";
  try {
    const res = await inferHeroku({
      tier: "short",
      messages: [
        {
          role: "user",
          content:
            'Title this banker conversation in 4-6 words: "Which HNW clients look dormant this quarter?". Return the title only, no quotes.',
        },
      ],
      maxTokens: 800,
    });
    if (!res.text || res.text.length < 3) {
      return { name, ok: false, detail: `empty response (stop=${res.stopReason})` };
    }
    return {
      name,
      ok: true,
      detail: `model=${res.modelId} stop=${res.stopReason} chars=${res.text.length}`,
    };
  } catch (e) {
    return { name, ok: false, detail: String(e instanceof Error ? e.message : e) };
  }
}

async function testReasoningStreaming(): Promise<TestResult> {
  const name = "Kimi (reasoning) — streaming emits tokens";
  try {
    let tokenCount = 0;
    let totalChars = 0;
    let done = false;
    for await (const ev of streamHeroku({
      tier: "reasoning",
      messages: [{ role: "user", content: "Count from 1 to 5, space-separated." }],
      maxTokens: 2000,
    })) {
      if (ev.type === "token") {
        tokenCount += 1;
        totalChars += ev.text.length;
      } else if (ev.type === "done") {
        done = true;
      }
    }
    if (!done) return { name, ok: false, detail: "stream did not emit done event" };
    if (tokenCount === 0)
      return { name, ok: false, detail: "stream emitted zero token deltas" };
    return {
      name,
      ok: true,
      detail: `tokens=${tokenCount} chars=${totalChars}`,
    };
  } catch (e) {
    return { name, ok: false, detail: String(e instanceof Error ? e.message : e) };
  }
}

async function testReasoningToolUse(): Promise<TestResult> {
  // Synthetic tool definition — model should decide to call `lookup_client`
  // rather than answer from nothing. Verifies tool-call parsing only.
  const name = "Kimi (reasoning) — tool use parsing";
  try {
    const res = await inferHeroku({
      tier: "reasoning",
      system:
        "You are a testing harness. When the user asks for a client by name, call the `lookup_client` tool with { name }. Do not answer in prose.",
      messages: [
        { role: "user", content: "Pull me the record for client David Chen." },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "lookup_client",
            description: "Look up a client record by full name.",
            parameters: {
              type: "object",
              properties: {
                name: { type: "string", description: "The client's full name." },
              },
              required: ["name"],
            },
          },
        },
      ],
      toolChoice: "auto",
      // Kimi K2 Thinking consumes tokens on internal reasoning before
      // emitting tool_calls — give it plenty of budget.
      maxTokens: 2000,
    });
    if (res.toolCalls.length === 0) {
      return {
        name,
        ok: false,
        detail: `model did not emit tool_calls (stop=${res.stopReason}, text="${res.text.slice(0, 80)}")`,
      };
    }
    const call = res.toolCalls[0]!;
    if (call.name !== "lookup_client") {
      return {
        name,
        ok: false,
        detail: `unexpected tool name: ${call.name}`,
      };
    }
    const input = call.input as { name?: string };
    if (!input || typeof input.name !== "string" || !input.name.trim()) {
      return {
        name,
        ok: false,
        detail: `tool call input missing 'name' string: ${JSON.stringify(call.input)}`,
      };
    }
    return {
      name,
      ok: true,
      detail: `tool=${call.name} input.name="${input.name}"`,
    };
  } catch (e) {
    return { name, ok: false, detail: String(e instanceof Error ? e.message : e) };
  }
}

async function main() {
  console.log("T0-3 Heroku inference smoke test\n");

  const tiers: HerokuInferenceTier[] = ["reasoning", "short"];
  let configErrors = 0;
  for (const t of tiers) {
    if (!isTierConfigured(t)) {
      console.log(`❌ tier ${t}: not configured (env vars missing)`);
      configErrors += 1;
    } else {
      console.log(`✓ tier ${t}: configured`);
    }
  }
  if (configErrors > 0) {
    console.log("\nAborting — fix env before running live tests.");
    process.exit(2);
  }
  console.log("");

  const results: TestResult[] = [];
  results.push(await testReasoningOneShot());
  results.push(await testShortOneShot());
  results.push(await testReasoningStreaming());
  results.push(await testReasoningToolUse());

  console.log("\nResults:");
  for (const r of results) {
    const mark = r.ok ? "✓" : "❌";
    console.log(`  ${mark} ${r.name}${r.detail ? `  — ${r.detail}` : ""}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${results.length - failed}/${results.length} passed${failed > 0 ? ` (${failed} failed)` : ""}`
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Smoke test crashed:", e);
  process.exit(1);
});
