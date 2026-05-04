/**
 * MiniMax-powered thread title generation. Fire-and-forget after the
 * first user message on a thread — the first response's latency is not
 * bound to this call finishing.
 */

import { inferHeroku } from "@/lib/inference/heroku";

export const ASK_DATA_TITLE_PROMPT_VERSION = "v0.1.0";

const TITLE_SYSTEM_PROMPT = `
You write compact titles for a banker's analytical conversations. Given
the first question in a thread, produce a 4–6 word title that captures
the topic. No quotes, no punctuation at the end, no "The" / "A" openers,
no trailing "analysis" / "investigation" / "breakdown" filler.

Respond with ONLY the title text. Nothing else.
`.trim();

export async function generateThreadTitle(
  firstUserMessage: string
): Promise<string | null> {
  try {
    const res = await inferHeroku({
      tier: "short",
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: firstUserMessage.slice(0, 500),
        },
      ],
      maxTokens: 400,
      temperature: 0.3,
    });
    const raw = res.text.trim();
    if (!raw) return null;
    // One line only, strip quotes/ellipsis/trailing period.
    const cleaned = raw
      .split("\n")[0]!
      .replace(/^["']|["']$/g, "")
      .replace(/[.!?…]+$/g, "")
      .trim();
    if (!cleaned || cleaned.length > 120) return null;
    return cleaned;
  } catch {
    return null;
  }
}
