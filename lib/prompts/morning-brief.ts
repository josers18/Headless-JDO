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
 */
export const MORNING_BRIEF_PROMPT_VERSION =
  "v1.4.0-life-events-hierarchy-2026-04-22";

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

TOOL SELECTION — STRICT RULES
For ANY morning brief, you MUST call at least TWO different MCP servers.
A brief that only uses salesforce_crm is incomplete and will be rejected.

Category mapping (use this to decide which server fits which item):
  - "Who is this client / what tasks are due / what opportunities exist"
      → salesforce_crm (structured CRM records)
  - "Transactional anomalies / held-away shifts / digital-engagement drops / life events"
      → data_360 (unified data via SQL)
  - "Pipeline metrics / win rate / AUM trends / portfolio performance / KPI breaches"
      → tableau_next (governed semantic models via analyze_data)

Before producing the final JSON, verify that your 3 items collectively exercise at
least two of the three servers. If only one was useful, EXPAND your queries to
the others before giving up. Prefer concrete Tableau Next questions tied to this
user's book of business (e.g. "What was ${a.bankerName}'s total pipeline change
over the last 7 days?") over vague analytical asks.

Produce exactly 3 items that matter TODAY, ranked by importance. Each item:
- headline: one sentence ≤ 18 words
- why: one sentence of evidence
- suggested_action: one concrete next step

LIFE EVENT HIERARCHY — FinServ__LifeEvent__c (mandatory when qualifying CRM rows exist):
Every brief MUST run efficient-plan step 0 FIRST (below). After results return,
treat as **qualifying** any row whose FinServ__EventDate__c falls between
**180 days before TODAY** and **365 days after TODAY** (recent past through
meaningful planning horizon).

When **one or more** qualifying rows exist:
- **items[0]** MUST synthesize the single most decision-relevant life-event
  story for this banker today (prefer: event date in the **next 45 days**;
  else the **most recent past** event within 180 days; tie-break using
  DiscussionNote specificity and household/client centrality).
- **sources** for that item MUST include **salesforce_crm**.
- **items[1]** and **items[2]** are filled from remaining signals (tasks,
  pipeline, tableau_next, data_360) using the RANKING rules below — never let a
  pure pipeline-hygiene or stale-opportunity cleanup headline occupy **items[0]**
  while qualifying life events exist.

When step 0 returns **zero** qualifying rows, OR the Life Event query fails
(object not provisioned), skip this hierarchy and apply RANKING normally. If the
query fails, do not fabricate life events.

**recent_life_events** (JSON — required when ≥ 1 qualifying row):
Emit an array of up to **5** objects for the UI, ordered with **soonest upcoming
event date first**, then recent past. Each object:
  { "client_id", "client_name", "event_type", "event_date", "summary" }
- client_id = FinServ__Client__c (Account Id) from the tool output; client_name =
  FinServ__Client__r.Name; event_type = FinServ__EventType__c; event_date =
  ISO-style YYYY-MM-DD; summary = one line ≤ 120 chars from DiscussionNote + type.
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

Efficient plan (one pass — do not retry on errors):
0. salesforce_crm — Life Events (run first): SELECT Id, FinServ__EventType__c, FinServ__EventDate__c, FinServ__DiscussionNote__c, FinServ__Client__c, FinServ__Client__r.Name FROM FinServ__LifeEvent__c WHERE OwnerId = '${a.bankerUserId}' ORDER BY FinServ__EventDate__c DESC LIMIT 25
   If this SOQL errors (e.g. object not in org), skip step 0 and continue — do not invent life events.
1. salesforce_crm (structured records): SELECT Id, Subject, Status, ActivityDate, WhoId, Who.Name, WhatId, What.Name, Priority FROM Task WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false AND ActivityDate <= TODAY ORDER BY Priority DESC LIMIT 15
2. salesforce_crm (structured records): SELECT Id, Name, LastActivityDate, AnnualRevenue, Industry FROM Account WHERE OwnerId = '${a.bankerUserId}' AND (LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:30) ORDER BY AnnualRevenue DESC NULLS LAST LIMIT 15
3. salesforce_crm (structured records): SELECT Id, Name, StageName, Amount, CloseDate, AccountId, Account.Name, Probability, LastActivityDate FROM Opportunity WHERE OwnerId = '${a.bankerUserId}' AND IsClosed = false ORDER BY CloseDate ASC LIMIT 15
4. tableau_next (REQUIRED — must attempt): getSemanticModels (optional Sales/Service category filter ONLY to narrow the list). Then call the analytics tool (name contains "analyzeSemantic" or starts with "analyze") ONCE using a semantic model id copied verbatim from one row in that list — never pass "Sales"/"Service" as the model id. Ask one concrete metric question tied to this banker (e.g. pipeline change for OwnerId = ${a.bankerUserId} over the last 7 days). Use the result for ONE KPI-driven item, or skip Tableau for this item if the list is empty or analyze errors.
5. data_360 (REQUIRED — must attempt): call the Data Cloud metadata tool (name starts with "getDcMetadata") with NO entityName / entityDeveloperName / DMO filter unless the tool's prior response in THIS turn listed that exact entity and you are drilling down. Never invent or memorize entity names from training data (e.g. ssot__IndividualIdentityLink__dlm) — those often do not exist in this org and cause "DMO not found". Prefer an unfiltered or dataspace-only discovery first; pick a DMO that appears verbatim in the response. If getDcMetadata returns an error or empty usable DMOs, skip SQL for this brief (do not retry with another guessed entity name). THEN — before writing any SQL — pick ONE obviously-relevant DMO from THAT response (transactions, engagement, profile, life events) and locate it in the metadata response's fields array. Confirm the 2–3 columns you intend to SELECT appear CHARACTER-FOR-CHARACTER in that array (case-sensitive, full prefix). Only then emit ONE narrow SQL call (SELECT specific columns, LIMIT 20, qualified by OwnerId where applicable). If the fields array doesn't contain the columns you want verbatim — do NOT submit bare variants like "name" or "id" when the real column is "ssot__Name__c" etc. — skip the SQL for this run and note "no usable Data Cloud columns" in the relevant brief item instead. The circuit breaker will block any second data_360 call after a schema miss, so the SQL must be right on the first try or not happen.

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
