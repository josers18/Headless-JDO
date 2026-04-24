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
//
// DO NOT STAGE THE DEMO.
//   An earlier revision of this file hardcoded specific client names
//   ("David Chen is the churn anchor"), pattern interpretations
//   ("4 closed accounts + zero balance = pre-departure signal"), and
//   scoping assumptions ("the 6 demo clients have zero Opps/Cases/Events
//   — run the query anyway and say so"). That was wrong. It turned
//   Horizon into a play-by-play narrator of a fixed script instead of
//   a live concierge reading the org.
//
//   Rule going forward: this prompt may encode facts about the org's
//   DATA MODEL (object names, field names, join paths, FSC managed
//   package shapes — things that are true whether the seed data exists
//   or not). It must NOT encode facts about the org's CURRENT CONTENTS
//   (who's at risk this week, which clients have pipeline, which
//   accounts are closed). Contents always come from live tool results.
//   The seeded Person Accounts are day-zero grounding so the app has
//   something to chew on, NOT a permanent cast of characters.

export interface AskAnythingArgs {
  bankerUserId: string;
  /**
   * True when the chat transcript already includes `role: tool` messages
   * (prior turns). Follow-ups may answer from that context without repeating
   * the same broad MCP queries.
   */
  hasPriorToolContext?: boolean;
  /**
   * Optional UI-derived hint (scroll section, focused client). Internal —
   * helps the model prioritize interpretation; must not be quoted to the banker.
   */
  scrollContext?: string;
}

export function askAnythingPrompt(
  utterance: string,
  args: AskAnythingArgs
): string {
  const prior = Boolean(args.hasPriorToolContext);
  const jobLead = prior
    ? `Your job: answer the banker's question using MCP tool results already present in this conversation when they are enough, and calling MCP tools only when the question needs NEW or FRESHER data. Your training data does not contain this bank's book — any specifics must still be grounded in tool results (from earlier turns in this thread and/or new calls this turn), never invented.`
    : `Your job: answer the following banker question using ONLY data returned by MCP tool calls made in THIS turn. Your training data does not contain this bank's clients, accounts, pipeline, transactions, or metrics — any specifics you produce must be grounded in a tool result from this turn or they are wrong.`;

  const hardContract1 = prior
    ? `1. If prior tool messages in this thread already contain the rows or fields needed (e.g. "which of those have a maturity this month?"), filter or interpret that data first and answer without re-issuing the same broad listing queries. When you need facts that are NOT in prior tool output, call MCP tools before stating them.`
    : `1. Before writing ANY prose, you MUST call at least one MCP tool. Your first model output for this turn is a tool_call, never assistant text.`;

  const hardContract2 = prior
    ? `2. Every client name, account name, amount, date, Salesforce Id, or metric in your final answer must appear in a tool_result from this conversation (an earlier turn) OR from a tool_result in this turn. If you didn't see it in any tool result in the thread, do not write it.`
    : `2. Every client name, account name, amount, date, Salesforce Id, or metric in your final answer must appear in a tool_result from THIS turn. If you didn't see it in a tool result, do not write it.`;

  const scroll =
    args.scrollContext && args.scrollContext.trim().length > 0
      ? `
UI FOCUS (internal — use only to prioritize which sources to consult first; do not echo this block to the banker):
${args.scrollContext.trim()}
`
      : "";

  const anchorFollowThrough =
    args.scrollContext?.includes("UI ANCHOR") === true &&
    args.scrollContext.trim().length > 0
      ? `
UI ANCHOR FOLLOW-THROUGH (mandatory when the UI FOCUS block contains "UI ANCHOR"):
The question's subject is the headline/entity named in that block—not whatever row happens to look "most urgent" in a generic tool listing.
Your answer must explain or justify first-move priority FOR THAT ANCHOR. You may cite MCP tool results only in service of explaining THAT item.
If you find a different person or task in tools, you may mention it only as contrast or contradiction; you must NOT replace the anchor headline with another name as if it were what the banker asked about.
`
      : "";

  return `${jobLead}

QUESTION:
"${utterance}"
${scroll}${anchorFollowThrough}
BANKER CONTEXT (pre-resolved — DO NOT call getUserInfo):
  The banker asking this question is Salesforce user Id \`${args.bankerUserId}\`.
  Use this Id VERBATIM for any \`OwnerId =\` filter you need. Do NOT write
  literal placeholders like "<UNKNOWN>", "<bankerUserId>", or the Id of any
  other user you might have seen in prior training data. Do NOT call
  salesforce_crm.getUserInfo just to re-resolve this Id — it is already
  resolved. Only call getUserInfo if the question genuinely asks about a
  DIFFERENT user (e.g. "who on the team has the most open tasks").

HARD CONTRACT (zero-tolerance — violations invalidate the answer)
${hardContract1}
${hardContract2}
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
  - **Never** use CRM-shaped names like \`AccountId__c\`, \`OwnerId__c\`, or
    \`ContactId__c\` on Data Cloud SQL just because SOQL uses \`AccountId\` /
    \`OwnerId\` — those literals cause \`unknown column\` unless the exact
    token appears in **this turn's** getDcMetadata fields list for that table.
  - Do NOT invent Data Cloud DMO developerNames because a similarly named
    Salesforce object exists (e.g. guessing \`PersonLifeEvent_*__dll\` from
    CRM \`PersonLifeEvent\`). If getDcMetadata in THIS turn does not list an
    entity with that exact developerName, do not call postDcQuerySql against
    it — use salesforce_crm for PersonLifeEvent / Account / Task instead and
    note that unified lakehouse life-event rows were unavailable.
  - **SOQL Date fields:** \`Task.ActivityDate\`, \`Event.ActivityDate\`,
    \`Opportunity.CloseDate\` are **Date** types — filter with **unquoted**
    \`YYYY-MM-DD\` or tokens like \`TODAY\`, \`LAST_N_DAYS:90\`. **Never**
    \`ActivityDate < '2024-07-15'\` (quotes) — that yields INVALID_FIELD on
    ActivityDate in this org.
  - **SOQL rolling windows:** use \`NEXT_N_DAYS:7\` / \`LAST_N_DAYS:30\` (letter
    **N**, colon, number). **Never** \`NEXT_7_DAYS\` or \`LAST_30_DAYS\` — those
    are MALFORMED_QUERY in Salesforce.
  - If a tool result surfaces an INVALID_FIELD or unknown-column error,
    the circuit breaker will block retries. Accept that the field is
    missing and answer with whatever else you have. Do NOT try a
    renamed variant of the same field.

ORG SCHEMA — field and relationship shapes verified against this org's
metadata. You may SELECT these fields WITHOUT calling getObjectSchema
first (this narrow allow-list overrides the __c schema-check rule
above). Use these exact names — do NOT invent variants. This section
describes the org's data model; it does NOT preselect which records
are relevant — that always comes from live tool results, never from
this prompt.

  CLIENTS
    Object: Account  (this org uses Person Accounts;
                      filter IsPersonAccount = true for individuals,
                      or omit the filter for any Account incl. business)
    Fields: Id, Name, IsPersonAccount, PersonContactId, OwnerId,
            Industry, CreatedDate, LastActivityDate
    Join:   Account.PersonContactId = Contact.Id

  FINANCIAL ACCOUNTS  (FSC managed package)
    Object: FinServ__FinancialAccount__c
    Fields: Id, Name,
            FinServ__PrimaryOwner__c         → Account,
            FinServ__FinancialAccountType__c (picklist: Checking,
              Savings, Brokerage, Managed Account, Retirement Account,
              Credit Card, …),
            FinServ__Status__c               (picklist: Open, Closed, …),
            FinServ__Balance__c              (Currency)

  LIFE EVENTS
    Object: PersonLifeEvent   (this is the STANDARD object for person
                                life events in this org —
                                NOT FinServ__LifeEvent__c)
    Fields: Id, Name,
            PrimaryPersonId   → Contact (master-detail),
            EventType         (picklist: Retirement, Relocation, Job,
                               Marriage, Graduation, Home, …),
            EventDate         (Date/Time),
            EventDescription  (Long Text — author-supplied context;
                               quote verbatim rather than paraphrasing)
    Join:   PersonLifeEvent.PrimaryPerson.AccountId = Account.Id
            (life events attach to the Contact; traverse to Account
             via the Contact's AccountId)

  FINANCIAL GOALS  (FSC managed package, label "Financial Goal (Legacy)")
    Object: FinServ__FinancialGoal__c
    Fields: Id, Name,
            FinServ__PrimaryOwner__c → Account,
            FinServ__Household__c    → Account (nullable),
            FinServ__Type__c         (picklist: Retirement, Investment,
                                      Education, Other, …),
            FinServ__Status__c       (picklist: Not Started, In Progress,
                                      Complete, …),
            FinServ__TargetValue__c  (Currency — NOT TargetAmount),
            FinServ__ActualValue__c  (Currency),
            FinServ__InitialValue__c (Currency, often null),
            FinServ__TargetDate__c   (Date)
    Household rule: when FinServ__Household__c is populated, it is the
      authoritative join; fall back to FinServ__PrimaryOwner__c only
      when Household is null.
    Progress metric (if asked): FinServ__ActualValue__c /
      FinServ__TargetValue__c.

  TASKS
    Object: Task
    Fields: Id, Subject, Description (Long Text), WhatId → Account,
            WhoId → Contact, OwnerId, Status,
            Priority (High, Normal, Low), ActivityDate, CreatedDate
    Note: When Task.Description is populated by the record author, quote
      it verbatim rather than inferring the rationale. An empty
      Description means no stated rationale — do not invent one.

  OPPORTUNITIES
    Object: Opportunity  (standard)
    Fields: Id, Name, AccountId → Account, StageName, Amount, CloseDate,
            Probability, ForecastCategoryName, OwnerId, CreatedDate

  CASES
    Object: Case  (standard)
    Fields: Id, CaseNumber, AccountId → Account, ContactId → Contact,
            Subject, Status, Priority, Type, Reason, Origin, OwnerId,
            CreatedDate, ClosedDate

  EVENTS (calendar)
    Object: Event  (standard)
    Fields: Id, Subject, WhatId → Account, WhoId → Contact,
            ActivityDateTime, DurationInMinutes, Description, OwnerId

  ALERTS  (FSC managed package)
    Object: FinServ__Alert__c
    Fields: Id, Name (Auto Number),
            FinServ__Account__c          → Account
                                           (NOT FinServ__Client__c —
                                            that field does not exist),
            Contact__c                   → Contact,
            FinServ__FinancialAccount__c → FinServ__FinancialAccount__c,
            FinServ__Message__c            (Text 255),
            FinServ__MessageDescription__c (Text 255),
            FinServ__Priority__c           (picklist),
            FinServ__Severity__c           (picklist),
            FinServ__Active__c             (Checkbox — this is the
                                            active/inactive flag;
                                            there is no
                                            FinServ__Status__c here),
            Score__c (Number), CreatedDate

  HOLDINGS  (FSC managed package)
    Object: FinServ__FinancialHolding__c
    Fields: Id, Name,
            FinServ__PrimaryOwner__c      → Account,
            FinServ__FinancialAccount__c  → FinServ__FinancialAccount__c
                                            (master-detail),
            FinServ__Securities__c        → FinServ__Securities__c,
            FinServ__Symbol__c            (Formula Text, derived from
                                           Securities — do not expect
                                           SecurityName or SecurityType
                                           fields; they do not exist),
            FinServ__Shares__c, FinServ__Price__c,
            FinServ__PurchasePrice__c, FinServ__MarketValue__c,
            FinServ__GainLoss__c, FinServ__PercentChange__c,
            FinServ__AssetCategory__c, FinServ__AssetClass__c

EMPTY-RESULT HONESTY — for any of the objects above, when a scoped
query returns zero rows, that emptiness is the answer. Say so plainly
("no open opportunities for this banker", "no cases logged in the last
30 days") and move on. Do not fabricate counts, stages, amounts, or
subjects to fill a gap, and do not extrapolate from other objects to
invent what a missing object would have contained.

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

2. Owner scoping (the banker's user Id is ALREADY RESOLVED in BANKER CONTEXT above — paste it verbatim into any OwnerId filter; do not re-resolve). If the question uses "my" ("my clients", "my pipeline", "my accounts"), the first OwnerId-scoped SOQL is the one that follows entity resolution.

3. Facet dispatch. Based on the category mapping above, fire the tool(s) that actually answer the question. For lookalike / anomaly / engagement questions, call data_360's metadata tool (name starts with "getDcMetadata") first to enumerate DLOs, then ONE narrow SQL. For AUM / pipeline / win-rate questions, call tableau_next getSemanticModels first, then ONE analyze tool — copy the semantic model identifier verbatim from a listed row (never use "Sales"/"Service" as the model id; those are list filters only).

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

C. OPTIONAL FOLLOW-UP SUGGESTIONS. After the prose (and after the actions JSON block if you included one), you MAY append ONE additional fenced JSON block holding up to three short questions the banker would plausibly ask NEXT, given the answer you just gave. This block is the absolute last thing in your response — nothing after its closing fence.

   Shape (exactly this — no other keys):

\`\`\`json
{
  "follow_up_suggestions": [
    "Which should I contact first?",
    "Draft a different angle for Vogel",
    "Show me the pattern details"
  ]
}
\`\`\`

   Rules for follow_up_suggestions (violations will be silently dropped by the UI):
     - MAX 3 items. Fewer is fine. Zero is correct when the answer is simple and complete.
     - Each item ≤ 8 words. Short, conversational, banker-voiced.
     - They MUST be conversational continuations of the answer you just gave — reference the entities, clients, or findings in your prose, not generic CRM concepts. ("Which should I contact first?" is good; "Show me my accounts" is not.)
     - Phrased as QUESTIONS from the banker's perspective, not commands you'd give yourself. ("What drove Vogel's drop?" — yes. "Draft email to Vogel" — no, that's an action, belongs in the actions block.)
     - OMIT the block entirely (do not emit empty \`follow_up_suggestions: []\`) when the answer is self-contained and there is no natural next question. Examples where you MUST omit: a single factual lookup ("What time is my next meeting?" → "3:30 PM with Patel" — no follow-ups), an honest empty-data response ("I couldn't find that data"), or a completed one-step action confirmation. Do NOT fabricate follow-ups to fill space.
     - Never echo Salesforce Ids, tool names, or internal jargon into these suggestions. The banker reads them as natural language.

If you cannot make ANY grounded recommendation (tools empty, question out of scope), return one honest paragraph of prose and SKIP both JSON blocks. Never pad.`;
}
