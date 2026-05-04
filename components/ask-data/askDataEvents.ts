/**
 * Custom-event names for Ask My Data's intra-page messaging. Kept in
 * one file so the producer (ContextRail) and consumer (Conversation)
 * can't drift.
 */
export const ASK_DATA_FOLLOW_UP_PICK_EVENT = "horizon:ask-data:follow-up-pick";

export type AskDataFollowUpPickDetail = {
  suggestion: string;
};
