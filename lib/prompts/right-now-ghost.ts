import type { BriefItem } from "@/types/horizon";

/**
 * Serialized "Right Now" hero for ghost-ask / Ask Bar `context` so the model
 * answers about the same card the banker sees, not a different CRM row.
 */
export function rightNowGhostAskContext(item: BriefItem): string {
  const parts = [
    'UI ANCHOR (authoritative): The banker\'s question refers ONLY to the "Right Now" hero card on the home page. The subject is exactly the fields below—do not substitute another client, task, or opportunity as "the Right Now item".',
    `Headline: ${item.headline}`,
    `Why (from brief): ${item.why}`,
    `Suggested action: ${item.suggested_action}`,
  ];
  if (item.client_id?.trim()) {
    parts.push(
      `Linked Salesforce id (for lookups): ${item.client_id.trim()}`
    );
  }
  if (item.sources?.length) {
    parts.push(`Brief source tags: ${item.sources.join(", ")}`);
  }
  parts.push(
    "Use MCP tools to ground facts, but the narrative must defend why THIS headline is the right first move—not why some other row returned by a broad query is urgent.",
    "If tools contradict this headline, say so in one short sentence, then still explain the brief's reasoning for THIS item (do not pivot the answer to a different person's name)."
  );
  return parts.join("\n");
}
