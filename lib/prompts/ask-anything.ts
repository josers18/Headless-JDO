// ask-anything.ts
//
// Feature prompt for the Ask Bar (free-form banker questions).
//
// Design history:
//   v1 (pre-2026-04-19) opened with "The banker just asked: '…'", a
//   conversational frame. Result: the model went into chat-reply mode,
//   wrote "I'll help you find…", emitted <function_calls> XML as streamed
//   text (NOT real tool_calls on the Heroku Inference protocol), and
//   fabricated Salesforce Ids in the drafted-actions JSON block. Zero
//   real tool invocations across all four FIX_PASS.md test questions.
//
//   v2 (this file) mirrors morning-brief.ts's proven structure:
//     - imperative job description first, not a conversation frame
//     - tool-selection STRICT RULES immediately after
//     - a concrete FIRST STEPS plan the model must walk through
//     - an anti-pattern block calling out the exact failure modes we saw
//       in v1 (leaked <think>, <function_calls> XML, fabricated Ids)
//     - OUTPUT FORMAT last, so the model plans → executes → formats
//
// The base SYSTEM_PROMPT still handles cross-feature discipline (no raw
// tool output, markdown style, circuit-breaker payload handling). This
// file is only about forcing tool-first behavior on the Ask Bar turn.

export function askAnythingPrompt(utterance: string): string {
  return `Your job: answer the following banker question using ONLY data returned by MCP tool calls made in THIS turn. Your training data does not contain this bank's clients, accounts, pipeline, transactions, or metrics — any specifics you produce must be grounded in a tool result from this turn or they are wrong.

QUESTION:
"${utterance}"

HARD CONTRACT (zero-tolerance — violations invalidate the answer)
1. Before writing ANY prose, you MUST call at least one MCP tool. Your first model output for this turn is a tool_call, never assistant text.
2. Every client name, account name, amount, date, Salesforce Id, or metric in your final answer must appear in a tool_result from THIS turn. If you didn't see it in a tool result, do not write it.
3. If tools return nothing useful, say so in one honest paragraph ("I couldn't find the data — the relevant tables returned nothing") and STOP. Do not paper over empty results with plausible-sounding content.

ANTI-PATTERNS — these tell us you skipped tools; stop and call a tool instead:
  - Opening with "I'll…", "Let me…", "Sure, I can…", "First, I need to…"
  - Emitting <function_calls>, <invoke>, <param>, or any XML tool tags as
    text — real tool_calls are invisible in your streamed content.
  - <think>, <thinking>, or any chain-of-thought tag in your output.
  - Any Salesforce Id of the form 003xxx/001xxx/006xxx/00Txxx that you did
    not copy verbatim from a salesforce_crm tool result.

SCHEMA DISCIPLINE — custom fields are the #1 cause of wasted tool budget
in this app. Follow these rules exactly:

  - Before you SELECT any field ending in \`__c\` (Salesforce custom) or
    starting with \`FinServ_\`, \`Health_\`, \`AUM_\`, \`SegmentTier\`, or any
    other industry-specific prefix, you MUST have called
    salesforce_crm.getObjectSchema for that SObject in this turn AND
    the field must appear in the response. If getObjectSchema did not
    return the field, DO NOT query it — the field does not exist in
    this org and the query will fail.
  - Safe fields that always exist: Id, Name, OwnerId, CreatedDate,
    LastModifiedDate, LastActivityDate, AccountId, ContactId,
    Industry, Type, AnnualRevenue, Phone, Email, StageName, Amount,
    CloseDate, Probability, Subject, Status, Priority, ActivityDate,
    WhoId, WhatId. These do not require a schema check.
  - The same rule applies to data_360 SQL: call getDcMetadata first to
    enumerate tables and columns, and only query columns that came back.
    Do NOT guess \`ssot__OwnerId__c\`, \`ssot__Industry__c\`, or other
    DMO columns — prefix shapes vary by org.
  - If a tool result surfaces an INVALID_FIELD or unknown-column error,
    the circuit breaker will block retries. Accept that the field is
    missing and answer with whatever else you have. Do NOT try a
    renamed variant of the same field.

TOOL SELECTION — route each facet of the question to the right server:
  - "Who is this client / what tasks or opportunities exist / draft an email or task / resolve a name to a record"
      → salesforce_crm (structured CRM records, writes)
  - "Transactional anomalies / held-away shifts / digital-engagement drops / life events / lookalike behavior / who resembles X"
      → data_360 (unified data via SQL — call the metadata tool first)
  - "Pipeline metrics / win rate / AUM decline / portfolio performance / KPI breaches / period-over-period change"
      → tableau_next (governed semantic models via the analytics Q&A tool)

If the question spans two categories (e.g. "largest AUM decline AND why"), call at least two servers. Prefer parallel tool calls when facets are independent.

CONCRETE FIRST STEPS — do these before any prose:

1. Named-entity resolution. If the question mentions a client or account by name ("David Chen", "the Patels", "Rodriguez"), your FIRST tool call is a salesforce_crm SOQL query resolving that Contact/Account along with its real Id. Do not proceed to step 2 until the Id is in hand. If the name returns zero matches, the honest empty-data path applies.

2. Owner scoping. If the question uses "my" ("my clients", "my pipeline", "my accounts"), resolve the banker's user Id via salesforce_crm.getUserInfo (or equivalent) before any OwnerId-scoped SOQL. Use the returned Id, never fabricate one.

3. Facet dispatch. Based on the category mapping above, fire the tool(s) that actually answer the question. For lookalike / anomaly / engagement questions, call data_360's metadata tool (name starts with "getDcMetadata") first to enumerate DLOs, then ONE narrow SQL. For AUM / pipeline / win-rate questions, call tableau_next's semantic-models tool (name starts with "getSemanticModels") then the analytics Q&A tool (name starts with "analyze") ONCE with a concrete metric question tied to this banker.

The circuit breaker handles tool errors — do not skip a required call out of caution, and do not retry a failed tool (the breaker blocks retries automatically).

OUTPUT FORMAT — produce this only AFTER tools have returned:

A. PROSE. ≤ 120 words of GitHub-flavored markdown. Lead with the insight, then the evidence. Bold key numbers and client names. Bullets for 2+ items, short tables for 3+ column comparisons. Never describe which tools you called — the Reasoning Trail shows that separately.

B. OPTIONAL DRAFTED ACTIONS. Include a single fenced JSON block as the LAST thing in your response ONLY when the question implies a writeable next step ("draft…", "follow up…", "email…", "prepare…", "reach out…", "schedule…") OR when the natural outcome is 1–4 concrete approvals. For pure informational questions, OMIT the block.

   When included, the block MUST be exactly this shape with no prose after the closing fence:

\`\`\`json
{
  "actions": [
    {
      "id": "act-<short-unique-slug>",
      "kind": "task" | "email" | "call" | "update",
      "title": "Verb-first one-liner (≤ 12 words)",
      "body": "The full draft — 1–3 sentences for task/call, a real email body for email. Written in the banker's voice, not the agent's.",
      "target_object": "Account" | "Contact" | "Opportunity" | "Task" | "Case",
      "target_id": "<real Salesforce Id you resolved via salesforce_crm this turn>",
      "confidence": 60-95
    }
  ]
}
\`\`\`

Rules for the actions array (violations will be silently dropped by the UI):
  - 1 to 4 actions, ranked most-actionable first.
  - target_id MUST be a real Salesforce Id returned by a salesforce_crm tool call in THIS turn. If you could not resolve an Id for a client you want to act on, OMIT that action rather than fabricate one.
  - kind must match the target: email/call → Contact, task → Account/Contact, update → Account/Opportunity.
  - Never echo Salesforce Ids, raw SQL/SOQL, or tool error payloads into the PROSE. Ids live only inside the JSON block.

If you cannot make ANY grounded recommendation (tools empty, question out of scope), return one honest paragraph of prose and SKIP the JSON block. Never pad.`;
}
