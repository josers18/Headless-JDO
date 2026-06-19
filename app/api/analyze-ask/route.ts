import type { NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken, getSessionId } from "@/lib/salesforce/token";
import { recordTokenUsage } from "@/lib/db/tokenUsage";
import { openFirstPartyTableauNext } from "@/lib/mcp/firstPartyTableauNext";
import { getModelProfile } from "@/lib/analyze/getModelProfile";
import { runAnalyzeAgent } from "@/lib/inference/analyzeAgent";
import {
  buildAnalyzeSystemPrompt,
  type ActiveSdm,
} from "@/lib/prompts/analyze";
import { makeAnalyzeStream } from "@/lib/sse/analyze";
import {
  isAnalyzeDbConfigured,
  upsertLatestAnalysis,
  type AnalyzeContentBlock,
} from "@/lib/db/analyzeSessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/analyze-ask
 *
 *   body: {
 *     modelId: string;
 *     question: string;
 *     priorTurns?: Array<{ userQuestion: string; assistantText: string }>;
 *   }
 *
 * Streams an analyze turn over SSE. When `priorTurns` is present, each
 * entry is expanded into an alternating (user, assistant) pair before
 * the new user question — giving Kimi the conversation so follow-ups
 * like "make it a bar chart" can resolve against the previous answer.
 * Server caps to the last 3 turns for context-window safety.
 *
 * Persists the completed turn via upsertLatestAnalysis (Q-T2-3-b-detail
 * = A: per-user, per-model latest only). If the DB isn't configured,
 * the stream still runs — we just skip the persist step.
 */
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId) return jsonError("unauthenticated", 401);
  const sessionId = await getSessionId();
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) {
    return jsonError("salesforce session expired", 401);
  }

  let body: {
    modelId?: unknown;
    question?: unknown;
    priorTurns?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const question =
    typeof body.question === "string" ? body.question.trim() : "";
  if (!modelId) return jsonError("modelId required", 400);
  if (!question) return jsonError("question required", 400);
  if (question.length > 4_000) {
    return jsonError("question too long (max 4000 chars)", 400);
  }

  const priorTurns = parsePriorTurns(body.priorTurns);

  const profile = await getModelProfile(modelId);
  if (!profile) return jsonError("model not found", 404);

  const activeSdm: ActiveSdm = {
    id: profile.id,
    apiName: profile.apiName,
    label: profile.label,
    description: profile.description,
    businessPreferences: profile.businessPreferences,
  };

  const systemPrompt = buildAnalyzeSystemPrompt(activeSdm);

  return makeAnalyzeStream(async (send) => {
    const mcp = await openFirstPartyTableauNext({
      salesforceToken: sfToken.access_token,
      signal: req.signal,
    });

    const chatMessages: ChatCompletionMessageParam[] = [];
    for (const t of priorTurns) {
      chatMessages.push({ role: "user", content: t.userQuestion });
      chatMessages.push({ role: "assistant", content: t.assistantText });
    }
    chatMessages.push({ role: "user", content: question });

    // Detect visualization / drill-down follow-ups so the agent loop
    // forces `analyze_data` on iteration 1. Only fires when prior
    // turns exist (a "follow-up" with no prior turn is just a fresh
    // ask — let `auto` handle it).
    const forceAnalyzeData =
      priorTurns.length > 0 && isVisualizationFollowUp(question);

    let finalAssistantText = "";
    let assistantContent: AnalyzeContentBlock[] | null = null;

    // Per-turn token-spend accumulators — one token_usage row per turn,
    // matching the main stack (see ask-data/route.ts for the rationale).
    const usageAcc = {
      model: "",
      inputTokens: 0,
      outputTokens: 0,
      exact: true,
      toolCalls: 0,
    };
    const turnStartedAt = Date.now();

    try {
      for await (const ev of runAnalyzeAgent({
        system: systemPrompt,
        messages: chatMessages,
        mcp,
        signal: req.signal,
        bankerQuestion: question,
        forceAnalyzeDataFirstIteration: forceAnalyzeData,
      })) {
        if (ev.type === "token") {
          send({ type: "token", text: ev.text });
        } else if (ev.type === "tool_call") {
          send({
            type: "tool_call",
            callId: ev.callId,
            name: ev.name,
            input: ev.input,
          });
        } else if (ev.type === "tool_result") {
          usageAcc.toolCalls += 1;
          send({
            type: "tool_result",
            callId: ev.callId,
            name: ev.name,
            isError: ev.isError,
            preview: ev.preview,
            ...(typeof ev.resultTokens === "number"
              ? { resultTokens: ev.resultTokens }
              : {}),
          });
        } else if (ev.type === "table_fallback") {
          send({
            type: "table_fallback",
            columns: ev.columns,
            rows: ev.rows,
            ...(ev.caption ? { caption: ev.caption } : {}),
          });
        } else if (ev.type === "chart_spec") {
          send({
            type: "chart_spec",
            spec: ev.spec,
            wasFallback: ev.wasFallback,
            ...(ev.fallbackReason ? { fallbackReason: ev.fallbackReason } : {}),
          });
        } else if (ev.type === "turn_complete") {
          finalAssistantText = ev.text;
          assistantContent = ev.contentBlocks;
        } else if (ev.type === "error") {
          send({ type: "error", message: ev.message });
        } else if (ev.type === "usage") {
          usageAcc.model = ev.model;
          usageAcc.inputTokens += ev.inputTokens;
          usageAcc.outputTokens += ev.outputTokens;
          usageAcc.exact = usageAcc.exact && ev.exact;
          send({
            type: "iteration_usage",
            iteration: ev.iteration,
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            exact: ev.exact,
          });
        }
      }
    } finally {
      await mcp.close();
    }

    // One row per turn — fire-and-forget; a DB failure must not break the SSE.
    if (usageAcc.model) {
      void recordTokenUsage({
        userId,
        sessionId,
        route: "analyze",
        model: usageAcc.model,
        inputTokens: usageAcc.inputTokens,
        outputTokens: usageAcc.outputTokens,
        exact: usageAcc.exact,
        toolCalls: usageAcc.toolCalls,
        durationMs: Date.now() - turnStartedAt,
      }).catch(() => {});
    }

    // Persist only when the DB is wired. Failure here is non-fatal for
    // the stream — we still emitted tokens + tool results; the banker
    // saw the analysis.
    if (isAnalyzeDbConfigured() && assistantContent) {
      try {
        await upsertLatestAnalysis({
          userId,
          modelId: profile.id,
          question,
          content: assistantContent,
        });
        send({ type: "persisted" });
      } catch {
        /* swallow — persistence is nice-to-have */
      }
    }

    // Suppress unused-variable warnings on finalAssistantText — the
    // value is forwarded as tokens; we only kept the final for future
    // polish (e.g., follow-up hints) that may wire in later.
    void finalAssistantText;
  });
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Heuristic: does this question look like a visualization change or
 * drill-down of prior data? If so, the agent loop will force Kimi to
 * call `analyze_data` on iteration 1 instead of letting it bluff in
 * prose.
 *
 * Deliberately conservative — false negatives (treating a genuine
 * follow-up as fresh) just mean the prompt rules have to carry the
 * load, which is the pre-change behavior. False positives (forcing
 * the tool on a true fresh question) would waste a tool call, so the
 * patterns here require either a pronoun / deictic reference OR an
 * unambiguous chart-shape verb.
 */
const FOLLOWUP_PATTERNS: RegExp[] = [
  // Pronouns + deictics
  /\b(it|that|this|them|these|those)\b/i,
  // View changes
  /\b(bar|pie|line|area|column|scatter|donut|treemap|heatmap|funnel|waterfall)\s*chart\b/i,
  /\bas\s+(a|an)\s+(bar|pie|line|area|column|scatter|donut|treemap|heatmap|funnel|waterfall)\b/i,
  /\b(show|make|render|turn|display|chart|plot|graph|visualize)\s+(it|that|this|these|those)\b/i,
  // Drill-downs / pivots
  /\bbreak\s+(it\s+)?down\b/i,
  /\bdrill\s+(in|into|down)\b/i,
  /\b(by|per|group(ed)?\s+by)\s+\w+/i,
  /\bsame\s+(but|except|for|thing)\b/i,
  // Comparative slicing
  /\bvs\.?\s+\w+/i,
  /\bcompared?\s+(to|with)\b/i,
];

function isVisualizationFollowUp(question: string): boolean {
  const q = question.trim();
  if (!q || q.length > 500) return false; // very long questions are usually fresh
  return FOLLOWUP_PATTERNS.some((re) => re.test(q));
}

type PriorTurnInput = { userQuestion: string; assistantText: string };

/**
 * Validate + normalize prior-turn history from the request body.
 * Drops entries that aren't non-empty strings on both sides, truncates
 * each side to prevent runaway prompt growth, and caps the array to the
 * last 3 turns (matches the follow-up generator's cap — same rationale:
 * keep context window predictable even after a long session).
 */
function parsePriorTurns(raw: unknown): PriorTurnInput[] {
  if (!Array.isArray(raw)) return [];
  const out: PriorTurnInput[] = [];
  for (const t of raw as Array<Record<string, unknown>>) {
    if (!t || typeof t !== "object") continue;
    const uq = typeof t.userQuestion === "string" ? t.userQuestion.trim() : "";
    const at =
      typeof t.assistantText === "string" ? t.assistantText.trim() : "";
    if (!uq || !at) continue;
    out.push({
      userQuestion: uq.slice(0, 2_000),
      assistantText: at.slice(0, 4_000),
    });
  }
  return out.slice(-3);
}
