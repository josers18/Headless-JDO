export interface MorningBriefPromptArgs {
  bankerName: string;
  localTime: string;
  dayOfWeek: string;
  date: string;
  bankerUserId: string;
  /** Banker's wall-clock hour 0–23 in DEMO_BANKER_TZ (I-1 signoff bands). */
  localHour24: number;
}

/**
 * Bumped whenever the JSON schema or a HARD RULE changes so caches
 * (Redis, browser, etc.) invalidate automatically. FINAL-1
 * (2026-04-21) added the per-item `right_now_cta` field and the
 * "RIGHT NOW CTA VERB" rule block. HOTFIX (2026-04-21 later)
 * added the band-keyed GREETING hard rule after the WRAP-UP /
 * OFF-HOURS bands were producing just "Jose," with no time-of-day
 * phrase because the schema example only showed "Good morning, X."
 * P1-1 (FIX_PASS): optional older_backlog for tasks overdue >14 days.
 * v1.4.0: FinServ life events — hierarchy + recent_life_events JSON + SOQL step 0.
 * v1.4.3: reinforce JSON string hygiene (physical newlines in quoted fields).
 * v1.4.4: PersonLifeEvent SOQL (this org's standard) + client-book filter; FinServ secondary.
 */
export const MORNING_BRIEF_PROMPT_VERSION =
  "v1.5.4-neutral-tool-names-2026-04-30";

export function morningBriefPrompt(a: MorningBriefPromptArgs): string {
  const firstName = a.bankerName.split(" ")[0] ?? a.bankerName;
  const h = a.localHour24;
  const band =
    h >= 6 && h < 11
      ? "MORNING (6–11 local)"
      : h >= 11 && h < 15
        ? "MIDDAY (11–15 local)"
        : h >= 15 && h < 19
          ? "WRAP-UP (15–19 local)"
          : "OFF-HOURS (before 6 or after 19 local)";
  return `Generate today's morning brief for ${a.bankerName}. It is ${a.localTime} on ${a.dayOfWeek}, ${a.date}.
Banker's local hour (24h clock): ${h}. Signoff time band: ${band}.

TOOL SELECTION
Call only the tools you need to ground 3 good items. ONE server is acceptable
when its data supports all three. Reach for a second server only when the first's
output is thin — never as a diversity quota. Do NOT retry a tool after it errors;
the runtime will block retries anyway and each failure wastes the tool budget.

Category mapping:
  - "Who is this client / what tasks are due / what opportunities exist /
     what meetings today / pipeline stage / open cases"
      → salesforce_crm (structured first-party CRM records)
  - External or behavioral signals CRM cannot see:
     held-away assets / outside brokerage movements / wire or ACH anomalies /
     digital-engagement drops (login, app, statement opens) / third-party
     enrichment / behavioral life-event inference / cross-source reconciliation
      → data_360 (unified + external data via SQL)
  - "Pipeline metrics / win rate / AUM trends / portfolio performance / KPI breaches"
      → tableau_next (governed semantic models via analyze_data)

HARD BUDGET: Maximum 5 tool calls total. Once you have enough for 3 items, STOP
calling tools and emit the final JSON — do not chase diversity at that point.

Produce exactly 3 items that matter TODAY, ranked by importance. Each item:
- headline: one sentence ≤ 18 words
- why: one sentence of evidence
- suggested_action: one concrete next step

LIFE EVENTS — FIRST PRIORITY (always run, always leads the brief when rows qualify):

Life events are the single most action-forcing signal a banker can act on: they
are time-bound, human-scale, and often reveal liquidity / planning moves the
client has NOT yet discussed. Every brief starts with life-event discovery
BEFORE touching tasks, pipeline, or metrics.

**Step 0a is mandatory and always runs first.** Step 0b is a cheap fallback that
runs ONLY when 0a returned zero rows OR 0a errored (object not in org). Never
run both when 0a already returned qualifying rows — that wastes budget.

**Qualifying** = event date falls between **180 days before TODAY** and
**365 days after TODAY** (recent past through meaningful planning horizon).
Use **EventDate** for PersonLifeEvent; **FinServ__EventDate__c** for FinServ rows.

When **one or more** qualifying rows exist (from 0a, or 0b if 0a was empty):
- **items[0] MUST** synthesize the single most decision-relevant life-event
  story (prefer: event date in the **next 45 days**; else the **most recent
  past** event within 180 days; tie-break using description / DiscussionNote
  specificity and household/client centrality).
- **sources** for items[0] MUST include **salesforce_crm**.
- **items[1]** and **items[2]** are filled from remaining signals using the
  RANKING rules below — pipeline-hygiene or stale-account cleanup NEVER
  outranks a qualifying life event.

When 0a (and 0b, if 0a was empty) both return zero qualifying rows or error,
skip the hierarchy and apply RANKING normally. Never fabricate life events.

**recent_life_events** (JSON — required when ≥ 1 qualifying row after merge):
Emit an array of up to **5** objects for the UI, ordered with **soonest upcoming
event date first**, then recent past. Each object:
  { "client_id", "client_name", "event_type", "event_date", "summary" }
Mapping:
- **From PersonLifeEvent:** client_id = **PrimaryPerson.AccountId** (household/business Account); client_name =
  **PrimaryPerson.Account.Name**; event_type = **EventType**; event_date = **EventDate** as YYYY-MM-DD;
  summary = one line ≤ 120 chars from **EventDescription** or **Name** + EventType.
- **From FinServ__LifeEvent__c:** client_id = **FinServ__Client__c**; client_name =
  **FinServ__Client__r.Name**; event_type = **FinServ__EventType__c**; event_date =
  **FinServ__EventDate__c** as YYYY-MM-DD; summary from **FinServ__DiscussionNote__c** + type.
When there are **no** qualifying rows, **omit** the "recent_life_events" key
(do not emit an empty array).

RANKING — additional rules (these govern WHICH items survive into the final 3,
after the LIFE EVENT HIERARCHY above when it applies):

- Reversibility beats magnitude. An item actionable TODAY or THIS WEEK ranks
  above a larger item that can only be addressed weeks from now. A $50K deal
  closing Friday outranks a $5M deal closing in two months.

- Overdue-task freshness cap. When ranking overdue tasks for the brief,
  consider ONLY tasks overdue by ≤ 14 days. Tasks overdue > 14 days are
  housekeeping backlog, not a morning signal — do not surface them as brief
  items, and do not quote their exact overdue day-count in any headline.
  Exception: if the banker has zero fresh overdue tasks (≤ 14 days) AND
  zero other hot signals (meetings today, deals closing this week, live
  cross-source discrepancies, recent life events), you MAY surface ONE
  stale-overdue item phrased as "X open tasks need triage" — aggregated,
  never pointing at a single year-old row. This is the graceful-empty
  path, not the default.

- The #1 item must be one of:
    a) actionable within the next 48 hours (a meeting, a deal step, a call),
    b) tied to a dated trigger (market event, maturity, life event this week), OR
    c) a live cross-source discrepancy (CRM says one thing, Data Cloud or
       Tableau Next says another) that becomes less reversible the longer
       it sits. These are legitimate hero items even without a 48-hour clock.

- Never quote an overdue day-count > 30 in a headline. If a task is 382 days
  overdue, the banker knows. Saying it is scolding, not helpful. Reframe as
  "Long-stale insurance review for Judy Odom" or similar, OR drop the item.

Efficient plan (one pass — do not retry on errors — life events ALWAYS first):

0a. salesforce_crm — **PersonLifeEvent** (MANDATORY first call, always runs before any other step).
    Scope to the banker's book (rows they own OR on Accounts they own):
SELECT Id, Name, EventType, EventDate, EventDescription,
       PrimaryPerson.AccountId, PrimaryPerson.Account.Name
FROM PersonLifeEvent
WHERE OwnerId = '${a.bankerUserId}'
   OR PrimaryPerson.Account.OwnerId = '${a.bankerUserId}'
ORDER BY EventDate DESC NULLS LAST
LIMIT 25
    If this SOQL errors (object not in org), continue to 0b. If it returns qualifying rows, SKIP 0b — don't waste a call.

0b. salesforce_crm — **FinServ__LifeEvent__c** (fallback — runs ONLY when 0a returned zero qualifying rows OR errored):
SELECT Id, FinServ__EventType__c, FinServ__EventDate__c, FinServ__DiscussionNote__c,
       FinServ__Client__c, FinServ__Client__r.Name
FROM FinServ__LifeEvent__c
WHERE OwnerId = '${a.bankerUserId}'
   OR FinServ__Client__r.OwnerId = '${a.bankerUserId}'
ORDER BY FinServ__EventDate__c DESC NULLS LAST
LIMIT 25
    If this SOQL errors, skip and move on — do not retry, do not fabricate life events.
1. salesforce_crm (structured records): SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name, Priority FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY Priority DESC LIMIT 15
2. salesforce_crm (structured records): SELECT Id, Name, LastActivityDate, AnnualRevenue, Industry FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
3. salesforce_crm (structured records): SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 15
4. tableau_next (REQUIRED — always attempt, governed KPIs are a core differentiator). This is the only server that can produce period-over-period ratios, win-rate, and governed metric narratives — CRM counts alone cannot compute these and DC cannot bind them to the semantic layer.

   EXECUTION (one pass, no retries):
   a) the tableau_next models-list tool ONCE (category filter "Sales" is OK ONLY to narrow the list; never pass "Sales"/"Service" as the model id itself).
   b) Pick ONE real model identifier from a returned row — copy verbatim.
   c) Call the analytics tool (name contains "analyzeSemantic" or starts with "analyze") ONCE with a concrete question tied to this banker (pipeline change over 7 days, win rate, AUM delta, etc.).
   d) Use the answer to ground ONE brief item with a tableau_next source.
   e) If the tableau_next models-list tool errors, returns no rows, or analyze errors: do NOT retry — move on and note "governed metrics unavailable this turn" in the narrative of whichever item would have used it.
5. data_360 (PRESCRIPTIVE — call when ANY of the criteria below are met). This is the server that surfaces external, behavioral, and unified data that CRM alone cannot see — skipping it when a criterion applies is a defect, not a budget saving.

   CALL data_360 IF ANY OF:
   - The banker's book has HNW or affluent accounts (AnnualRevenue present in step 2 results) — look for held-away asset shifts or large external transactions in the last 7 days.
   - Step 3 surfaced stalled opportunities (no recent LastActivityDate) — check digital-engagement signals (login, app, statement opens) to see if the client has disengaged.
   - Life events (step 0a) returned zero qualifying rows — check behavioral life-event inference (new address, employer change, dependent added) in Data Cloud.
   - Step 2 surfaced stale accounts (>30 days no activity) — check external transaction / wire / ACH anomalies for those accounts to find a concrete outreach hook.
   - It is a Monday OR the start of a month — weekly/monthly behavioral trend DMOs are most useful at these inflection points.

   SKIP data_360 ONLY IF: the data_360 metadata tool errors, OR the metadata response lists no DMOs that map to the criterion above, OR you have already produced 3 strong items and would exceed the 5-call budget.

   EXECUTION (one pass, no retries):
   a) the data_360 metadata tool ONCE (unfiltered) — read the full fields[] array for every returned DMO.
   b) Pick ONE DMO whose name/fields match the criterion that triggered this step (transactions, engagement, profile, life events).
   c) Verify every column you plan to SELECT appears CHARACTER-FOR-CHARACTER in that DMO's fields array (case-sensitive, full prefix like "ssot__" or "__c").
   d) Emit ONE narrow SQL call (SELECT specific columns, LIMIT 20, filter by OwnerId when the DMO exposes it). Never "SELECT *", never bare lowercase "name"/"id".
   e) If the fields array doesn't contain the columns you need verbatim, skip SQL and note "no usable Data Cloud columns for this DMO" — do not guess. The circuit breaker blocks retries anyway.

RIGHT NOW SELECTION (UI v2 — mandatory field):
After finalizing the 3 ranked items, set "right_now_index" to 0, 1, or 2 — the
index inside the "items" array for the ONE item the banker should handle in
the next ~15 minutes. Priority order:
  - If **items[0]** is grounded in a qualifying Life Event from step 0,
    **right_now_index MUST be 0** — life-event moments outrank pipeline cleanup.
  - Else: shortest reversibility window (actionable TODAY > this week > later)
  - Else: dated trigger (meeting today, maturity, deadline, scheduled touchpoint)
  - Else: relationship risk (churn, competitive pressure, engagement cliff)

If two items tie, prefer the one with the most specific human CTA (a named
person to call or meet) over an abstract "review the pipeline" item.
Always set right_now_index — default 0 only when item 0 is clearly the best.

OLDER BACKLOG (FIX_PASS P1-1 — optional JSON field "older_backlog"):
After you run the Task query in the efficient plan, COUNT how many returned open
tasks have ActivityDate MORE than 14 calendar days before TODAY (housekeeping
backlog — excluded from the 3 brief items per the freshness cap above).

- If that count is zero OR you could not classify tasks from tool output, OMIT
  the "older_backlog" key entirely from the JSON (do not emit null or zero).

- If count ≥ 1, include:
    "older_backlog": {
      "task_count": <integer>,
      "summary": "<one sentence: themes only — e.g. insurance renewals, KYC follow-ups>"
    }

Rules for summary:
  - Describe WHAT kinds of work backed up (categories, subjects), NOT exact
    overdue day counts ("381 days") — that reads as scolding.
  - ≤ 140 characters. No Salesforce Ids. No raw SOQL field names.

These tasks must NOT appear as duplicate headlines in "items" — they are listed
only under older_backlog for transparency when the banker expands the pill.

JSON field rules:
- Whenever you set "client_id" to a Salesforce 15- or 18-character Id, you MUST also set "client_name" to that record's human-readable name (Account Name, Contact Name, etc.) from the tool response you used — the UI links names in the copy to Salesforce.
- If headline/why/suggested_action name MORE than one specific Account or Contact (e.g. "Judy Odom", "Harry Gray", and "Susan Hall"), "entity_links" MUST list { "client_id", "client_name" } for EVERY named person or account (except only duplicate the primary client_id if it is the same record). Omit "entity_links" only when a single client is named. Missing links for named clients is a defect.
- VALID JSON ONLY — obey RFC 8259 string escaping (control chars, embedded quotes). Never put raw newline or tab characters inside a quoted string — use \\n and \\t escapes only. A physical line break inside "why" or "headline" invalidates the entire payload.

GREETING (field "greeting") — HARD RULES (HOTFIX 2026-04-21):
The JSON example below shows "Good morning, ${firstName}." as a schema stub,
NOT as the required value. The greeting string MUST follow this band-keyed
template — time-of-day word, a comma, the banker's first name, a period:
  - MORNING band (6–11 local)   → "Good morning, ${firstName}."
  - MIDDAY band (11–15 local)   → "Good afternoon, ${firstName}."
  - WRAP-UP band (15–19 local)  → "Good afternoon, ${firstName}."
  - OFF-HOURS band (before 6 or after 19 local) → "Good evening, ${firstName}."
Do NOT output a greeting that is only the name, only a punctuation mark, or
an empty string. The greeting must always contain a full time-of-day phrase
plus the name. This is the hero headline — if it is missing, the top of the
page is broken.

SIGNOFF (field "signoff") — HARD RULES (I-1):
- One line only, max 14 words, professional concierge tone (not wellness / not parenting).
- MORNING band (6–11 local): forward-looking; may use "morning" / "today" naturally.
- MIDDAY band (11–15 local): mid-day check; reference the next concrete move; do NOT use the words "morning" or "Good morning".
- WRAP-UP band (15–19 local): end-of-day framing, tomorrow prep allowed, but no rest/sleep/wellness language; do NOT use "morning" or "Good morning".
- OFF-HOURS band (before 6 or after 19 local): NEUTRAL only — e.g. "Two items flagged for tomorrow — everything else can wait." FORBIDDEN: rest, sleep, wellness, "get some rest", "go to sleep", "first thing in the morning", scolding about lateness. Do NOT use "morning" or "Good morning".
- The substring "morning" (any case) may appear in signoff ONLY in the MORNING band.

RIGHT NOW CTA VERB (FINAL-1 — mandatory on the item selected by right_now_index):
For the item you select as right_now_index, include a "right_now_cta" field — a
short, specific imperative verb phrase extracted from suggested_action. All three
items MAY include it (harmless), but it is only REQUIRED on the one referenced by
right_now_index. This string becomes the primary button label on the hero card;
it MUST read as a concrete next move, not a filler word.

HARD RULES:
- 1–2 words (hyphenated compounds like "closed-lost" count as one word), ≤ 18 characters, Title Case.
- The verb must match the dominant action in suggested_action.
- NEVER emit the generic word "Review" UNLESS suggested_action literally asks the
  banker to READ or STUDY something (e.g. "Review the Patel proposal before the
  3pm meeting."). If the action is to UPDATE a record or MARK a deal closed-lost,
  that is NOT a review — use the update/mark verb instead.
- FORBIDDEN generic verbs unless suggested_action genuinely calls for them:
  "Review", "Take action", "Continue", "Proceed", "Handle", "Manage", "Open",
  "See", "Look at", "Check". Prefer the specific verb from suggested_action.
- If multiple verbs appear, pick the MORE DEFINITIVE one (close > update,
  call > message, mark > review, book > schedule).

Examples:
  suggested_action: "Call Chen before his 3pm board meeting."
    → right_now_cta: "Call"
  suggested_action: "Update the close date and stage, or mark closed-lost to
                     clean your pipeline forecast."
    → right_now_cta: "Mark closed-lost"   (more definitive than "Update stage")
  suggested_action: "Book a 20-minute review for Wednesday."
    → right_now_cta: "Book 20m"
  suggested_action: "Draft outreach for these three lookalikes."
    → right_now_cta: "Draft outreach"
  suggested_action: "Schedule a portfolio review this week."
    → right_now_cta: "Schedule"
  suggested_action: "Review the Patel proposal before the 3pm meeting."
    → right_now_cta: "Review"   (literal reading — legitimate)

Return structured JSON ONLY (no prose, no markdown fences). The "greeting"
string MUST match the band-keyed template in the GREETING rules above —
for this request the correct value is: ${
  h >= 6 && h < 11
    ? `"Good morning, ${firstName}."`
    : h >= 11 && h < 19
      ? `"Good afternoon, ${firstName}."`
      : `"Good evening, ${firstName}."`
}.
{
  "greeting": "Good morning, ${firstName}.",
  "items": [
    { "headline": "...", "why": "...", "suggested_action": "...", "right_now_cta": "Update stage", "sources": ["data_360"|"salesforce_crm"|"tableau_next"], "client_id": "...?", "client_name": "...?", "entity_links": [{"client_id":"...","client_name":"..."}] }
  ],
  "signoff": "One line, slightly personal, time-aware.",
  "right_now_index": 0,
  "recent_life_events": [
    { "client_id": "001XXXXXXXXXXXXXXX", "client_name": "Patel Household", "event_type": "College", "event_date": "2026-09-03", "summary": "Daughter begins university — align 529 and liquidity." }
  ],
  "older_backlog": { "task_count": 4, "summary": "Mostly stale insurance reviews and dormant relationship check-ins." }
}`;
}
