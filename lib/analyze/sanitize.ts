/**
 * Strip <think>…</think> blocks from streamed model output.
 *
 * Kimi K2 Thinking occasionally emits its chain-of-thought inside
 * <think> tags before the actual answer. Rendering those tags verbatim
 * in the banker UI looks unprofessional. This sanitizer carries state
 * across token chunks because an opening <think> can land in one chunk
 * and the closing </think> in another.
 *
 * Usage:
 *   const s = stripThinkTags();
 *   for each token chunk: yield s.push(chunk);
 *   // chunks inside <think>…</think> are suppressed entirely.
 */
export function stripThinkTags(): { push: (chunk: string) => string } {
  let inThink = false;
  let pendingTail = ""; // partial "<th" / "<thi" / "</t" we haven't resolved yet

  function push(chunk: string): string {
    let input = pendingTail + chunk;
    pendingTail = "";
    let out = "";

    while (input.length > 0) {
      if (inThink) {
        const closeIdx = input.indexOf("</think>");
        if (closeIdx === -1) {
          // Might be a partial close at the tail. Keep the last 8 chars
          // (length of "</think>") back so we don't miss a split tag.
          if (input.length > 8) {
            pendingTail = input.slice(-8);
          } else {
            pendingTail = input;
          }
          input = "";
        } else {
          // Skip everything up to and including the closing tag.
          input = input.slice(closeIdx + "</think>".length);
          inThink = false;
        }
      } else {
        const openIdx = input.indexOf("<think>");
        if (openIdx === -1) {
          // No tag in this chunk — but the tail might be the start of one.
          // Hold back up to 7 chars (len of "<think>") so a split tag
          // isn't emitted as raw text.
          if (input.length > 7 && couldBePartialOpen(input.slice(-7))) {
            out += input.slice(0, -7);
            pendingTail = input.slice(-7);
          } else {
            out += input;
          }
          input = "";
        } else {
          out += input.slice(0, openIdx);
          input = input.slice(openIdx + "<think>".length);
          inThink = true;
        }
      }
    }

    return out;
  }

  return { push };
}

/** Cheap check: does the tail look like the start of "<think>"? */
function couldBePartialOpen(tail: string): boolean {
  const prefixes = ["<", "<t", "<th", "<thi", "<thin", "<think"];
  return prefixes.some((p) => tail.endsWith(p));
}

/**
 * One-shot variant — strips complete <think>…</think> blocks from a
 * full string. Useful when rehydrating persisted content where the
 * streamer isn't in play.
 */
export function stripThinkTagsSync(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
