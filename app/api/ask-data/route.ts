import type { NextRequest } from "next/server";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { currentBankerUserId } from "@/lib/ask/currentUser";
import {
  appendMessage,
  getThread,
  isDbConfigured,
  listMessages,
  renameThread,
  touchThread,
  type AskMessageContentBlock,
  type AskMessageRow,
} from "@/lib/db/askThreads";
import { runAskDataAgent } from "@/lib/inference/askDataAgent";
import {
  ASK_DATA_SYSTEM_PROMPT,
} from "@/lib/prompts/ask-data";
import { generateThreadTitle } from "@/lib/prompts/ask-data-title";
import { generateFollowUps } from "@/lib/prompts/ask-data-followups";
import {
  askDataSseHeaders,
  makeAskDataStream,
} from "@/lib/sse/askData";
import { openFirstPartyDataCloud } from "@/lib/mcp/firstPartyDataCloud";
import { ensureFreshToken } from "@/lib/salesforce/token";
import {
  loadCachedDcMetadata,
  toSystemPromptSection as toDcCatalogSection,
} from "@/lib/llm/dcMetadataCache";
import { log } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/ask-data
 *
 *   body: { threadId: string; question: string }
 *
 * Streams the Ask My Data turn over SSE. Persistence order per
 * Q-T1-3-e = C: user message first, assistant at stream end, thread
 * touched once. Auth per Q-T1-3-c = A: reject with 401 if no session
 * cookie. Errors per Q-T1-3-d = A: stream error event + persist whatever
 * prose we already accumulated.
 */
export async function POST(req: NextRequest) {
  const userId = await currentBankerUserId();
  if (!userId) {
    return jsonError("unauthenticated", 401);
  }

  // Auth upgrade from T1-3 (self-hosted MCP) to Path C (first-party
  // Data 360 MCP): the Salesforce-hosted MCP authenticates with the
  // banker's PKCE-issued access token, so we need a live + fresh one
  // here. A cookie alone isn't enough — if refresh fails the caller
  // needs to re-authenticate via /api/connect.
  const sfToken = await ensureFreshToken();
  if (!sfToken?.access_token) {
    return jsonError("salesforce session expired", 401);
  }

  if (!isDbConfigured()) {
    return jsonError("database unavailable", 503);
  }

  let body: { threadId?: unknown; question?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("invalid JSON body", 400);
  }

  const threadId =
    typeof body.threadId === "string" ? body.threadId.trim() : "";
  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  if (!threadId) return jsonError("threadId required", 400);
  if (!question) return jsonError("question required", 400);
  if (question.length > 4_000)
    return jsonError("question too long (max 4000 chars)", 400);

  // Verify ownership up-front — 404 not 200 on foreign threadId.
  const thread = await getThread({ id: threadId, userId });
  if (!thread) return jsonError("thread not found", 404);

  const priorMessages = await listMessages({ threadId });
  const isFirstTurn = priorMessages.length === 0;

  return makeAskDataStream(async (send) => {
    // (1) Persist the user message first so refresh mid-stream still
    // shows the question (Q-T1-3-e = C).
    const userRow = await appendMessage({
      threadId,
      role: "user",
      content: [{ type: "text", text: question }],
    });
    send({ type: "user_persisted", messageId: userRow.id });

    // (2) Open the first-party Data 360 MCP session with the banker's
    // Salesforce token. If this throws, the error event propagates via
    // makeAskDataStream's catch.
    const mcp = await openFirstPartyDataCloud({
      salesforceToken: sfToken.access_token,
      signal: req.signal,
    });

    // (3) Build the chat message list the agent reads.
    const chatMessages: ChatCompletionMessageParam[] = [
      ...priorMessages.flatMap(toChatMessages),
      { role: "user", content: question },
    ];

    // Preload the Data Cloud metadata catalog from Redis (refreshed
    // hourly by Heroku Scheduler, per CLAUDE.md §15). When the cache
    // is warm we:
    //   (a) append a compact DMO + fields catalog to the system prompt
    //       so Kimi already knows what objects exist and can jump
    //       straight to SQL without 4 exploratory get_dc_metadata
    //       round-trips, and
    //   (b) hide `get_dc_metadata` from the model's tool list so it
    //       can't burn iterations re-discovering what's already in
    //       context.
    // Cache miss: both signals are off and the agent falls back to
    // live discovery (pre-cache behavior).
    const cachedDcMetadata = await loadCachedDcMetadata();
    // Ask My Data runs multi-turn exploratory sessions. Kimi has been
    // observed inventing column names when the tail field list is
    // short (default 12). We widen the catalog here:
    //   - fullFieldsTopCount 40 (vs default 20) — more DMOs get FULL
    //     field lists, which is where exact column names live.
    //   - tailFieldsPerDmo 30 (vs default 12) — even truncated DMOs
    //     show enough columns that Kimi can usually find what it needs
    //     without guessing. The `+N more` marker still signals when
    //     truncation is in effect.
    // Total prompt size grows ~20KB vs default but Kimi handles it
    // fine and the alternative is hallucinated columns + retries.
    const dcCatalogSection = toDcCatalogSection(cachedDcMetadata, {
      fullFieldsTopCount: 40,
      tailFieldsPerDmo: 30,
    });
    const systemWithCatalog = dcCatalogSection
      ? `${ASK_DATA_SYSTEM_PROMPT}\n\n${dcCatalogSection}`
      : ASK_DATA_SYSTEM_PROMPT;
    if (cachedDcMetadata) {
      log.info("ask_data.dc_metadata.cache_hit", {
        dmos: cachedDcMetadata.survivingDmos,
        generatedAt: cachedDcMetadata.generatedAt,
        promptChars: dcCatalogSection.length,
      });
    } else {
      log.warn("ask_data.dc_metadata.cache_miss", {
        note:
          "REDIS_URL unset or cache empty — falling back to live " +
          "get_dc_metadata discovery. Expect multi-step reasoning trails.",
      });
    }

    let finalAssistantText = "";
    let assistantContent: AskMessageContentBlock[] | null = null;
    let sawError: string | null = null;

    try {
      for await (const ev of runAskDataAgent({
        system: systemWithCatalog,
        messages: chatMessages,
        mcp,
        signal: req.signal,
        preloadedDcMetadata: Boolean(cachedDcMetadata),
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
        } else if (ev.type === "turn_complete") {
          finalAssistantText = ev.text;
          assistantContent = ev.contentBlocks;
        } else if (ev.type === "error") {
          sawError = ev.message;
          send({ type: "error", message: ev.message });
        }
      }
    } finally {
      await mcp.close();
    }

    // (4) Persist assistant message — always, even if the turn errored.
    // Content blocks preserve the full tool-use/tool-result trail so the
    // next turn has MCP context (SETTLED DECISION).
    const persistBlocks: AskMessageContentBlock[] =
      assistantContent && assistantContent.length > 0
        ? assistantContent
        : [
            {
              type: "text",
              text: finalAssistantText || "(no response)",
            },
          ];
    const assistantRow = await appendMessage({
      threadId,
      role: "assistant",
      content: persistBlocks,
    });
    send({ type: "assistant_persisted", messageId: assistantRow.id });

    // (5) Touch thread once — bumps updated_at so it floats to the top
    // of the sidebar.
    await touchThread({ id: threadId, userId });

    // (6) If this was the thread's first turn, generate a title with
    // MiniMax and push it down the stream when it lands. Fire-and-forget
    // with persistence inside — we don't hold up the done event.
    if (isFirstTurn) {
      try {
        const title = await generateThreadTitle(question);
        if (title) {
          await renameThread({ id: threadId, userId, title });
          send({ type: "thread_title", title });
        }
      } catch {
        /* title is a nicety; failure is non-fatal */
      }
    }

    // (7) Follow-up suggestions (MiniMax). Only when the turn finished
    // with actual prose — no point suggesting follow-ups to an empty
    // or purely-errored turn.
    if (finalAssistantText && !sawError) {
      try {
        const suggestions = await generateFollowUps({
          userQuestion: question,
          assistantText: finalAssistantText,
        });
        if (suggestions.length > 0) {
          send({ type: "follow_ups", suggestions });
        }
      } catch {
        /* non-fatal */
      }
    }
  });
}

/**
 * Map a persisted AskMessageRow into the ChatCompletionMessageParam
 * shape Kimi expects. Drops tool_use/tool_result blocks from prior
 * assistant turns since the OpenAI-compatible `tool_calls` shape is
 * already reconstructed on the agent-loop side via the prior-turn
 * prose. For T1-3's first cut we flatten to text — richer replay
 * lands with multi-turn polish.
 */
function toChatMessages(
  row: AskMessageRow
): ChatCompletionMessageParam[] {
  const blocks = row.content ?? [];
  const textParts: string[] = [];
  for (const b of blocks) {
    if (b && typeof b === "object" && (b as { type?: string }).type === "text") {
      const t = (b as { text?: unknown }).text;
      if (typeof t === "string") textParts.push(t);
    }
  }
  const text = textParts.join("\n").trim();
  if (!text) return [];

  if (row.role === "user") {
    return [{ role: "user", content: text }];
  }
  if (row.role === "assistant") {
    return [{ role: "assistant", content: text }];
  }
  // "tool" / "system" historical rows — the agent rebuilds these each
  // turn; dropping them on replay avoids mismatched tool_call_id refs.
  return [];
}

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Hint unused imports so TS doesn't drop them in type-only slots.
void askDataSseHeaders;
