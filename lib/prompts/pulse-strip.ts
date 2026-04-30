// Pulse Strip — single-line flight-deck read (UI v2 T0-1 + UI_V3_FIX F-5).
// Contract: JSON only; multi-MCP in parallel; flight-deck callout style.
// F-5 rules: temperature label FIRST in ALL CAPS · positives over negatives ·
// ≤ 4 segments · 2–4 words per segment · max 12 words total.

export const PULSE_STRIP_PROMPT_VERSION = "v1.3.1-neutral-tool-names-2026-04-30";

export interface PulseStripPromptArgs {
  bankerUserId: string;
  bankerTz: string;
}

export function pulseStripPrompt(a: PulseStripPromptArgs): string {
  return `You are generating the Pulse Strip — a single-line flight-deck callout for a relationship banker. They must understand state in under 1 second.

BANKER (pre-resolved — do NOT call salesforce_crm.getUserInfo just to resolve this):
  Salesforce User Id: ${a.bankerUserId}
  Wall-clock timezone for "today" and EOD: ${a.bankerTz}

TOOL PLAN — call MCP tools in parallel when the question spans sources:
1. salesforce_crm: Today's calendar and workload for this owner only.
   - Tasks: ActivityDate = TODAY or overdue, Priority = High when relevant, Status != Completed
   - Events: ActivityDate = TODAY, StartDateTime >= NOW() in org TZ (use the banker's day)
   - Opportunities: IsClosed = false, OwnerId = banker, CloseDate = TODAY or NEXT 7 DAYS if they imply same-day urgency
2. data_360 (PRESCRIPTIVE — call when ANY criterion below is met). Pulse strip is the flight-deck temperature read: DC is where same-day anomalies and held-away events live, and those often drive the URGENT temperature that CRM alone would miss.

   CALL data_360 IF ANY OF:
   - Step 1 returned any Event scheduled within the next 4 hours — check whether that client has a wire/ACH anomaly in the last 24h (concrete talking point for the imminent meeting).
   - A high-Priority Task from step 1 is due today AND the client's account is HNW — check for held-away asset movements (same-day risk signal).
   - It is ≤ 11 AM in the banker's local tz (MORNING band) — check for overnight external transaction anomalies across the banker's book (the "what happened overnight" flight-deck instinct).

   SKIP data_360 ONLY IF: the data_360 metadata tool errors, no DMOs match any criterion, or the temperature is already clearly QUIET from step 1 (no time-sensitive work in the next few hours).

   EXECUTION — ultra-tight (strip must finish fast):
   a) the data_360 metadata tool ONCE (unfiltered).
   b) Pick ONE DMO matching the triggered criterion (transactions, held-aways).
   c) Verify every column verbatim in fields[] — case-sensitive, full prefix.
   d) One narrow call on the data_360 SQL tool (LIMIT 10, filter by account ids from step 1).
   e) If columns don't match, skip SQL — the breaker blocks retries anyway.
3. tableau_next: Optional. the tableau_next models-list tool to narrow, then bind the tableau_next analyze tool to a real model id from a row — never use "Sales" or "Service" as the model id. One metric only if it signals intraday or before-EOD risk; otherwise skip.

TEMPERATURE — pick exactly one:
- QUIET — no time-sensitive work in the next few hours; nothing URGENT below.
- ATTENTION — one or two time-sensitive items OR a notable pattern; nothing requiring action within 4 hours that is material/compliance-critical.
- URGENT — something should happen within 4 hours OR tool results show a material anomaly / time-bound risk for this banker today.

STRIP COPY RULES (flight-deck callout — hard rules, I-2):
- Segment 1: TEMPERATURE LABEL in ALL CAPS (e.g. "QUIET MONDAY", "ATTENTION", "URGENT") — always first.
- Segments 2–3 (optional 4th): ONLY urgency-relevant counts, deadlines, flags, or named risks. No neutral or "good news" padding mixed into ATTENTION/URGENT.
- Segment 4 (optional): next scheduled event only, form "next: 10AM Patel" — OR omit if none.
- Each segment 2–4 words. No sentences, no verbs-of-being, no filler ("as of today", "for you", "right now").
- NEVER put neutral/positive housekeeping in ATTENTION or URGENT strips (e.g. "calendar clear", "nothing overdue", "book stable", "open afternoon", "5 tasks created this week"). Positive slack belongs in Portfolio Pulse tiles, not here.
- QUIET days: SHORT strip (temperature + at most one workload count + optional "next: …"). Do not pad QUIET with filler to reach 4 segments.
- Total words across all segments ≤ 12 (excluding one optional leading emoji).

GOOD EXAMPLES:
- "QUIET TUESDAY · 8 open tasks · next: 3PM Patel"
- "ATTENTION · 5 due today · Chen flag · next 10AM Patel"
- "URGENT · HNW overdraft · draft ready · before EOD"

BAD EXAMPLES (do not produce these):
- "URGENT · 2 long-overdue · 8 open tasks · calendar clear" — mixes danger with irrelevant good news
- "8 open tasks · 2 overdue from July · no events today" — no temperature lead
- "QUIET MONDAY · There are 8 open tasks to review today" — filler words

OUTPUT — return a single JSON object ONLY (no markdown fence, no prose before or after):
{
  "temperature": "QUIET" | "ATTENTION" | "URGENT",
  "temperature_label": "string, ALL CAPS, ≤ 3 words (e.g. QUIET MONDAY, ATTENTION, URGENT)",
  "review_count": number,
  "next_event": { "time": "3:30 PM", "label": "Patel" } | null,
  "flag_count": number,
  "flag_deadline": "before EOD" | "this week" | "today" | null,
  "strip_line": "string — the entire one-line strip for the UI, following STRIP COPY RULES above. ≤ 12 words. Always begins with temperature_label in ALL CAPS."
}

Never invent client names, times, or Ids — only facts from tool results. If tools are empty, set temperature QUIET, review_count 0, next_event null, flag_count 0, strip_line: "QUIET · nothing pressing".`;
}
