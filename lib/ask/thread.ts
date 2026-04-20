import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const MAX_MESSAGES = 48;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Validates client-supplied messages for POST /api/ask.
 * Returns 400-worthy error string or null if OK.
 */
export function validateAskThreadMessages(
  raw: unknown
): { ok: false; error: string } | { ok: true; messages: ChatCompletionMessageParam[] } {
  if (!Array.isArray(raw)) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  if (raw.length === 0) {
    return { ok: false, error: "messages must be a non-empty array" };
  }
  if (raw.length > MAX_MESSAGES) {
    return { ok: false, error: `messages exceeds max (${MAX_MESSAGES})` };
  }
  const out: ChatCompletionMessageParam[] = [];
  for (const item of raw) {
    if (!isPlainObject(item)) {
      return { ok: false, error: "each message must be an object" };
    }
    const role = item.role;
    if (role !== "user" && role !== "assistant" && role !== "tool") {
      return { ok: false, error: "invalid message role" };
    }
    if (role === "tool") {
      const toolCallId = item.tool_call_id;
      if (typeof toolCallId !== "string" || !toolCallId.trim()) {
        return { ok: false, error: "tool messages require tool_call_id" };
      }
      const content = item.content;
      if (typeof content !== "string") {
        return { ok: false, error: "tool message content must be a string" };
      }
      out.push({ role: "tool", tool_call_id: toolCallId, content });
      continue;
    }
    if (role === "user") {
      const content = item.content;
      if (typeof content !== "string") {
        return { ok: false, error: "user message content must be a string" };
      }
      out.push({ role: "user", content });
      continue;
    }
    // assistant
    const content = item.content;
    const toolCalls = item.tool_calls;
    if (toolCalls !== undefined) {
      if (!Array.isArray(toolCalls)) {
        return { ok: false, error: "assistant tool_calls must be an array" };
      }
      for (const tc of toolCalls) {
        if (!isPlainObject(tc)) {
          return { ok: false, error: "invalid tool_calls entry" };
        }
        if (tc.type !== "function") {
          return { ok: false, error: "tool_calls[].type must be function" };
        }
        if (typeof tc.id !== "string" || !tc.id.trim()) {
          return { ok: false, error: "tool_calls[].id is required" };
        }
        const fn = tc.function;
        if (!isPlainObject(fn) || typeof fn.name !== "string") {
          return { ok: false, error: "tool_calls[].function.name is required" };
        }
        if (typeof fn.arguments !== "string") {
          return { ok: false, error: "tool_calls[].function.arguments must be a string" };
        }
      }
      const cStr = typeof content === "string" ? content : "";
      out.push({
        role: "assistant",
        content: cStr.length > 0 ? cStr : " ",
        tool_calls: toolCalls as Array<{
          id: string;
          type: "function";
          function: { name: string; arguments: string };
        }>,
      });
      continue;
    }
    if (typeof content !== "string") {
      return { ok: false, error: "assistant message content must be a string" };
    }
    out.push({ role: "assistant", content });
  }
  const last = out[out.length - 1];
  if (!last || last.role !== "user") {
    return { ok: false, error: "last message must be role user" };
  }
  return { ok: true, messages: out };
}
