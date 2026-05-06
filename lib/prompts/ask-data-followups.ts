/**
 * MiniMax follow-up suggestions. Called after each assistant turn
 * completes; produces 2–3 one-line question pills the banker can click
 * to continue drilling.
 */

import { inferHeroku } from "@/lib/inference/heroku";
import { log } from "@/lib/log";

export const ASK_DATA_FOLLOWUPS_PROMPT_VERSION = "v0.3.0";

/**
 * v0.3.0 — return a JSON OBJECT (not a bare array). The inference call
 * passes `response_format: { type: "json_object" }` which constrains
 * MiniMax to produce a top-level object. Previous versions instructed
 * the model to return a raw array, which contradicted the response
 * format and caused silent empty returns.
 */
const FOLLOWUP_SYSTEM_PROMPT = `
You write follow-up questions for a banker exploring their book of
business. You're given (optionally) the recent conversation history
plus the latest banker question and the assistant's answer. Produce
2–3 concrete next questions the banker might want to ask to continue
their analytical thread. Each follow-up must:

  • Be phrased as a question the banker would type, not a topic.
  • Build on the conversation so far — drill deeper into something
    just mentioned, pivot laterally to a related angle, or compare
    against something asked earlier. NOT a rephrase of any prior
    question.
  • Be ≤ 14 words.
  • Be specific — reference concrete entities, metrics, or numbers
    from the latest answer when useful.
  • Never start with "Would you like" / "Do you want" / "Can I".

Respond with ONLY a JSON object in this exact shape:

  {"suggestions": ["first question?", "second question?", "third question?"]}

No prose, no trailing commentary, no markdown fencing.
`.trim();

export type PriorTurn = {
  userQuestion: string;
  assistantText: string;
};

export async function generateFollowUps(input: {
  userQuestion: string;
  assistantText: string;
  /**
   * Earlier (user, assistant) pairs in chronological order. Most-recent
   * turn is NOT in this array — pass it separately as userQuestion /
   * assistantText. Cap enforced inside the function.
   */
  priorTurns?: PriorTurn[];
}): Promise<string[]> {
  try {
    const historyBlock = buildHistoryBlock(input.priorTurns);
    const userContent = [
      historyBlock,
      `LATEST BANKER QUESTION:\n${input.userQuestion.slice(0, 800)}`,
      `\nLATEST AGENT ANSWER:\n${input.assistantText.slice(0, 2_000)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const res = await inferHeroku({
      tier: "short",
      system: FOLLOWUP_SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 400,
      temperature: 0.5,
      responseFormat: { type: "json_object" },
    });
    const parsed = safeParse(res.text);
    if (!Array.isArray(parsed)) {
      log.warn("followups.parse_empty", {
        rawLen: res.text?.length ?? 0,
        rawPreview: (res.text ?? "").slice(0, 240),
        parsedKind: parsed === null ? "null" : typeof parsed,
      });
      return [];
    }
    const clean = parsed
      .filter((p): p is string => typeof p === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 140)
      .slice(0, 3);
    if (clean.length === 0) {
      log.warn("followups.clean_empty", {
        parsedLen: parsed.length,
        parsedPreview: JSON.stringify(parsed).slice(0, 240),
      });
    } else {
      log.info("followups.ok", { count: clean.length });
    }
    return clean;
  } catch (err) {
    log.error("followups.threw", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Serialize up to the last 3 prior turns as a compact transcript block.
 * Keeps each turn's quotes short so the prompt stays well under
 * MiniMax's context window even with 3 prior turns of rich prose.
 */
function buildHistoryBlock(prior?: PriorTurn[]): string {
  if (!prior || prior.length === 0) return "";
  const recent = prior.slice(-3);
  const lines = recent.map((t, i) => {
    const idx = recent.length - i;
    return [
      `--- ${idx} TURNS AGO ---`,
      `Banker: ${t.userQuestion.slice(0, 240)}`,
      `Agent: ${t.assistantText.slice(0, 600)}`,
    ].join("\n");
  });
  return ["CONVERSATION HISTORY (oldest first):", ...lines].join("\n\n");
}

function safeParse(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // response_format=json_object means MiniMax MUST return a JSON object;
  // if the model emits `{"follow_ups":[...]}` we accept either shape.
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") {
      for (const v of Object.values(parsed)) {
        if (Array.isArray(v)) return v;
      }
    }
    return null;
  } catch {
    // Fall back to extracting the first JSON array from the text.
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
