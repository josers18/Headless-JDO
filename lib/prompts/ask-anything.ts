// ask-anything.ts
//
// Feature prompt for the Ask Bar (free-form banker questions). The base
// SYSTEM_PROMPT handles cross-feature discipline (multi-MCP rule, MCP hygiene,
// no-raw-tool-output, markdown style). This file adds:
//   1) a hard category map so the model doesn't default to salesforce_crm
//   2) a strict output contract: prose first, then an optional fenced JSON
//      block of DraftAction[] that the UI can turn into clickable approve
//      buttons
//
// Keep this tight — the model sees both SYSTEM_PROMPT and this on every
// call, and long prompts drift.

export function askAnythingPrompt(utterance: string): string {
  return `The banker just asked:

"${utterance}"

TOOL SELECTION — use the right server for each facet of the question.
  - "Who is this client / what tasks or opportunities exist / draft an email or task"
      → salesforce_crm (structured CRM records, writes)
  - "Transactional anomalies / held-away shifts / digital-engagement drops / life events / lookalike behavior"
      → data_360 (unified data via SQL — call the metadata tool first)
  - "Pipeline metrics / win rate / AUM decline / portfolio performance / KPI breaches"
      → tableau_next (governed semantic models via the analytics Q&A tool)

If the question spans two categories (e.g. "which clients had the largest AUM
decline AND why"), you MUST call tools on at least two different servers. Prefer
parallel tool calls.

Resolve named clients to Salesforce records BEFORE drafting any action. If the
banker says "the Patels" and you find Anika Patel in salesforce_crm, use her
Contact Id as the draft target. Do NOT invent IDs.

OUTPUT FORMAT (strict — the UI parses this):

1. PROSE FIRST. Answer in ≤ 120 words of GitHub-flavored markdown. Lead with the
   insight, then the evidence. Bold key numbers and client names. Use a short
   bullet list when enumerating 2+ items. A compact markdown table is fine for
   3+ column comparisons. Do NOT describe which tools you called — the UI shows
   that separately in the Reasoning Trail.

2. THEN, OPTIONALLY, a single fenced JSON block with drafted actions. Include
   this block ONLY when the question implies an action the banker could approve
   today — e.g. "draft…", "follow up…", "email…", "prepare…", "reach out…",
   "schedule…", or any question whose natural next step is a write to the CRM.
   For pure informational questions ("what is…", "show me…" without a verb of
   action), OMIT the block entirely.

   When included, the block MUST be the LAST thing in your response, formatted
   exactly like this (no prose after the closing fence):

\`\`\`json
{
  "actions": [
    {
      "id": "act-<short-unique-slug>",
      "kind": "task" | "email" | "call" | "update",
      "title": "Verb-first one-liner (≤ 12 words)",
      "body": "The full draft — 1–3 sentences for task/call, a real email body for email. Written in the banker's voice, not the agent's.",
      "target_object": "Account" | "Contact" | "Opportunity" | "Task" | "Case",
      "target_id": "<real Salesforce Id you resolved via salesforce_crm>",
      "confidence": 60-95
    }
  ]
}
\`\`\`

Rules for the actions array:
  - 1 to 4 actions. Never more than 4. Prefer fewer, higher-confidence drafts.
  - Every \`target_id\` must be a real Salesforce Id you retrieved via
    salesforce_crm this turn. If you could not resolve an Id for a client you
    want to act on, OMIT that action rather than fabricate one.
  - \`kind\` reflects the target object: email/call for Contact, task for
    Account/Contact, update for Account/Opportunity, call for Contact only.
  - \`title\` is what the card shows; \`body\` is what the banker sends/logs.
  - \`confidence\` reflects how sure you are the action is worth doing today.
  - Never echo Salesforce Ids, raw SQL/SOQL, or tool error payloads into the
    PROSE. Ids live only in the JSON block.

If you cannot make ANY grounded recommendation (all tools failed, or the
question is off-scope), return a single honest paragraph saying so and skip
the JSON block entirely. Never pad.`;
}
