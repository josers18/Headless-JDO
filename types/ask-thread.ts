import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

/**
 * Ask Bar multi-turn thread — OpenAI Chat Completions shape (what Heroku
 * Inference `/v1/chat/completions` consumes). This is the structured equivalent
 * of preserving assistant tool rounds + tool results across turns.
 */
export type AskThreadMessage = ChatCompletionMessageParam;

export const ASK_THREAD_STORAGE_KEY = "horizon:ask-thread:v1";
