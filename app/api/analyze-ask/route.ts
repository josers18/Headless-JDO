import type { NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { currentBankerUserId } from "@/lib/ask/currentUser";
import { ensureFreshToken } from "@/lib/salesforce/token";
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
 *   body: { modelId: string; question: string }
 *
 * Streams a single-turn analyze over SSE. Persists the completed turn
 * via upsertLatestAnalysis (Q-T2-3-b-detail = A: per-user, per-model
 * latest only). If the DB isn't configured, the stream still runs —
 * we just skip the persist step and emit `persisted: false`-ish via
 * skipping the event.
 */
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId) return jsonError("unauthenticated", 401);
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) {
    return jsonError("salesforce session expired", 401);
  }

  let body: { modelId?: unknown; question?: unknown };
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

    const chatMessages: ChatCompletionMessageParam[] = [
      { role: "user", content: question },
    ];

    let finalAssistantText = "";
    let assistantContent: AnalyzeContentBlock[] | null = null;

    try {
      for await (const ev of runAnalyzeAgent({
        system: systemPrompt,
        messages: chatMessages,
        mcp,
        signal: req.signal,
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
          send({
            type: "tool_result",
            callId: ev.callId,
            name: ev.name,
            isError: ev.isError,
            preview: ev.preview,
          });
        } else if (ev.type === "table_fallback") {
          send({
            type: "table_fallback",
            columns: ev.columns,
            rows: ev.rows,
            ...(ev.caption ? { caption: ev.caption } : {}),
          });
        } else if (ev.type === "turn_complete") {
          finalAssistantText = ev.text;
          assistantContent = ev.contentBlocks;
        } else if (ev.type === "error") {
          send({ type: "error", message: ev.message });
        }
      }
    } finally {
      await mcp.close();
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
