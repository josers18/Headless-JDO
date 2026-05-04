/**
 * MiniMax follow-up suggestions. Called after each assistant turn
 * completes; produces 2–3 one-line question pills the banker can click
 * to continue drilling.
 */

import { inferHeroku } from "@/lib/inference/heroku";

export const ASK_DATA_FOLLOWUPS_PROMPT_VERSION = "v0.1.0";

const FOLLOWUP_SYSTEM_PROMPT = `
You write follow-up questions for a banker exploring their book of
business. Given the latest banker question and the assistant's answer,
produce 2–3 concrete next questions the banker might want to ask. Each
follow-up must:

  • Be phrased as a question the banker would type, not a topic.
  • Drill deeper OR pivot laterally — not rephrase the original.
  • Be ≤ 12 words.
  • Be specific to the data just returned (reference entities/segments
    from the answer when useful).
  • Never start with "Would you like" / "Do you want" / "Can I".

Respond with ONLY a JSON array of strings. Example:
  ["Which of these accounts have met this month?",
   "Show me the top five by held-away assets"]
No prose, no trailing commentary.
`.trim();

export async function generateFollowUps(input: {
  userQuestion: string;
  assistantText: string;
}): Promise<string[]> {
  try {
    const res = await inferHeroku({
      tier: "short",
      system: FOLLOWUP_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `BANKER ASKED:\n${input.userQuestion.slice(0, 800)}\n\nAGENT ANSWERED:\n${input.assistantText.slice(0, 2_000)}`,
        },
      ],
      maxTokens: 400,
      temperature: 0.5,
      responseFormat: { type: "json_object" },
    });
    const parsed = safeParse(res.text);
    if (!Array.isArray(parsed)) return [];
    const clean = parsed
      .filter((p): p is string => typeof p === "string")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length <= 140)
      .slice(0, 3);
    return clean;
  } catch {
    return [];
  }
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
