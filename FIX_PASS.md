# Horizon — Pre-Submission Fix Pass

> **Context for Cursor:** This is a prioritized task list based on a review of the deployed app at `headless-jdo-002d2a119b15.herokuapp.com`. The app is live but has a contest-critical blocker and several polish issues to address before the April 27 video submission.
>
> **Authoritative spec:** `CLAUDE.md` in repo root. When this file and `CLAUDE.md` conflict, `CLAUDE.md` wins — but these tasks reflect real defects observed in the running app.
>
> **Execution rules:**
> 1. Work tasks in priority order. Do not start P1 until all P0 tasks are green.
> 2. For each task: read the referenced files first, propose the smallest change, implement, verify against the "Done when" criteria.
> 3. If a task uncovers a deeper issue, surface it before expanding scope.
> 4. Commit after each completed task with message format: `fix(horizon): <task-name>`.

---

## 🚨 P0 — Contest-Critical (must ship before video)

These are the difference between winning and losing. Everything else is polish.

### P0-1 — Fix multi-MCP orchestration

**The problem:** Every source chip in the live app shows `SALESFORCE_CRM`. Neither `DATA_360` nor `TABLEAU_NEXT` is being invoked. The entire contest thesis — *three Salesforce hosted MCP servers orchestrated in parallel* — is silently broken. The Reasoning Trail showing "2 calls · 0" confirms the agent is only round-tripping to one server.

**Root causes to investigate (in this order):**

1. **Prompt instruction:** Open `lib/prompts/morning-brief.ts`. Verify the system prompt explicitly tells Claude to reach for all three servers with concrete category examples. If the prompt is permissive ("use the tools available"), it is not strong enough — Claude will default to the first server that answers.
2. **Empty data:** If Data 360 DLOs and Tableau Next semantic models are empty, Claude will call them, get nothing, and stop reaching for them. Verify via `curl` or the Anthropic playground that each server returns real rows/metadata when called directly.
3. **MCP server registration:** Open `lib/anthropic/client.ts` (or wherever `mcp_servers` is configured). Confirm all three URLs are in the array, all three have valid `authorization_token` values, and names are exactly `salesforce_crm`, `data_360`, `tableau_next`.
4. **Token scope:** The same Salesforce access token must have permissions for SObject reads, Data Cloud query, AND Tableau Next. If the token was minted with narrow scopes, Data 360 and Tableau Next calls will 403 silently. Check Connected App OAuth scopes.

**Files to touch:**
- `lib/prompts/morning-brief.ts` — strengthen orchestration instructions
- `lib/prompts/system.ts` — if exists, ensure base prompt enforces multi-MCP discipline
- `lib/anthropic/client.ts` — verify all 3 servers registered
- `lib/salesforce/token.ts` — verify token scopes include Data Cloud + Analytics

**Required prompt language to add** (if not already present in the system prompt):

```
TOOL SELECTION — STRICT RULES
For ANY morning brief, you MUST call at least TWO different MCP servers.
A brief that only uses salesforce_crm is incomplete and will be rejected.

Category mapping (use this to decide):
  - "Who is this client / what tasks are due / what opportunities exist"
      → salesforce_crm (structured CRM records)
  - "Transactional anomalies / held-away shifts / digital-engagement drops / life events"
      → data_360 (unified data via SQL)
  - "Pipeline metrics / win rate / AUM trends / portfolio performance / KPI breaches"
      → tableau_next (governed semantic models via analyze_data)

Before producing the final JSON, verify that your items collectively exercise at
least two of the three servers. If only one was useful, EXPAND your queries to
the others before giving up.
```

**Done when:**
- [ ] A fresh morning brief request shows ≥ 2 distinct values in the aggregated `sources` arrays across all 3 items
- [ ] Reasoning Trail on the home page shows MCP calls to at least 2 different servers
- [ ] At least one Portfolio Pulse metric is sourced from `tableau_next` (not a SOQL aggregation)
- [ ] `npx tsx scripts/verify-mcp.ts` still returns 3/3 green

---

### P0-2 — Build the Ask Bar (Act 2 hero)

**The problem:** The floating Ask Bar — the single most important interactive primitive in the entire product — is not present on the home page. Without it, Act 2 of the demo video (the "looks like David Chen" uncanny moment) cannot be filmed.

**Build requirements:**

- Fixed position: bottom-center, ~640px wide, ~72px tall, floating with 32px from viewport bottom
- Always visible on the home page; never scrolls off
- Text input with placeholder: `Ask Horizon anything...`
- Focus state: subtle glow using accent color from `components/brand/tokens.ts`
- Submit via Enter key OR microphone button (voice input)
- On submit: collapse the home page content slightly, expand a response panel below the bar with streaming tokens + a Reasoning Trail sidecar on the right
- After response: the bar remains; a small "← back to brief" link appears to restore the home view

**Files to create:**
- `components/horizon/AskBar.tsx` — the component
- `app/api/ask/route.ts` — SSE endpoint that proxies to Claude with all 3 MCPs
- `lib/prompts/ask-anything.ts` — system prompt for free-form questions
- `components/horizon/AskResponse.tsx` — the streaming response panel
- `lib/voice.ts` — Web Speech API wrapper for voice input (stretch: ElevenLabs output)

**Prompt for `ask-anything.ts`:**

```
You are Horizon, answering a free-form question from a relationship banker.

Orchestrate across salesforce_crm, data_360, and tableau_next as needed. Prefer
parallel calls when the question spans sources.

FORMAT
- Answer in ≤ 120 words unless explicitly asked to expand
- Lead with the insight, not the setup
- When the question implies an action, end with 1–3 DRAFTED actions the banker
  can approve with one click
- Actions must be verb-first and executable today
- If your answer identifies specific clients or records, include their Salesforce
  IDs so the UI can wire up one-click approvals

Never explain which tools you called — the UI shows that separately in the
Reasoning Trail.
```

**Test questions (must all work before filming):**

1. `Show me clients who look like David Chen did three months before he left.`
2. `Which of my clients had the largest AUM decline this week, and why?`
3. `Draft a follow-up for every account I haven't touched in thirty days.`
4. `What should I bring up in my 10 AM with the Patels?`

**Done when:**
- [ ] Ask Bar renders on home page, fixed-floating, always visible
- [ ] Typing + Enter streams a response with visible token flow
- [ ] Reasoning Trail sidecar shows MCP tool calls as they fire
- [ ] All 4 test questions above return a coherent, data-grounded answer
- [ ] At least 2 of the test questions produce clickable drafted actions
- [ ] Voice input works via microphone button (Web Speech API is fine for MVP)

---

### P0-3 — Seed the "demo moment" data

**The problem:** The video script depends on specific clients and signals existing in Data 360 and the CRM. Without them, the Ask Bar questions return generic noise instead of the hand-crafted beats that will carry the film.

**Run:**
```bash
npx tsx scripts/seed-data-cloud.ts --mode=all
```

**This must produce (verify in Salesforce + Data 360 after run):**

- **David Chen** (ID `003DEMO00DAVID01`) — HNW, $12.4M AUM, with a single `-$2,100,000` transaction dated ~18 hours ago to "Fidelity Brokerage" in his `money_market` account, flagged `isAnomaly=true`
- **Luis Rodriguez** (ID `003DEMO00RODRIG1`) — Retiree, $2.1M AUM, `lastContactDaysAgo=41`
- **Anika Patel** (ID `003DEMO00PATEL01`) — Affluent, with a life event `child_engagement` dated April 12
- **Three lookalikes** — Katherine Vogel, Marcus Okafor, Helena Brandt — HNW, moderate risk, declining mobile engagement over last 22–34 days

**If the seed script fails on CRM or Data 360 push:**
- `mode=files` still works and writes fixtures to `public/seed/` — use these as a fallback for UI testing
- Check `DC_CONNECTOR_NAME` env var matches your Data Cloud streaming connector
- Check `SF_INSTANCE_URL` is set and the access token has Data Cloud ingest scope

**Done when:**
- [ ] Querying SObject for Contact where LastName='Chen' returns David with correct custom fields
- [ ] A Data 360 SQL query for `Transaction WHERE amount < -2000000 AND date > TODAY - 2` returns Chen's anomaly row
- [ ] Asking "show me clients who look like David Chen" in the Ask Bar returns Vogel, Okafor, Brandt (not random other HNW clients)

---

## 🟡 P1 — Polish Before Filming

These will not cost you the contest individually, but collectively they're the difference between a demo that looks amateur and one that looks inevitable.

### P1-1 — Fix the "381 days overdue" signal quality

**The problem:** The current Morning Brief item #1 reads *"Four high-priority tasks are overdue, oldest by 381 days."* A year-old task is archaeology, not urgency. This is the hero headline and it's making the banker feel scolded, not served.

**Change in the Morning Brief prompt logic (and/or the backend query):**

- Filter overdue tasks to `overdue BETWEEN 1 AND 14 days` for "fresh urgency" ranking
- Aggregate anything `> 14 days overdue` into a single housekeeping item, de-prioritized
- Surface the older backlog via a collapsed "Older backlog (4)" pill below the brief, not as a hero signal
- Re-rank: reversibility window (today/this week) should beat raw magnitude for item selection

**File:** `lib/prompts/morning-brief.ts` — add this rule to the `RANKING` section:

```
RANKING — additional rules
- Reversibility beats magnitude: an item actionable TODAY ranks above a larger
  item actionable next month
- Filter overdue items to those overdue ≤ 14 days unless none exist that fresh
- Anything overdue > 14 days is housekeeping, not a morning signal
- The #1 item must be actionable within 48 hours or have a dated trigger
  (meeting, maturity, market event)
```

**Done when:**
- [ ] The top Morning Brief item references something happening today, this week, or a dated trigger
- [ ] Items older than 14 days are either filtered out or visually de-emphasized
- [ ] Re-running the brief 5 times produces consistently "fresh" top items

---

### P1-2 — Metric hygiene in Portfolio Pulse

**The problem:** The Pulse tile shows `Wins (30D) $0 · -$11K vs prior 30d`. A $0/-$11K delta is a rounding error dressed up as a trend, and it undercuts the banker's trust in the rest of the Pulse.

**Rules to apply (in the Portfolio Pulse prompt or rendering logic):**

1. Suppress comparisons where both values are < $100K OR the delta is < 20%
2. When a metric is zero, show the tile but label it neutrally ("No closed wins this period") — do NOT show a misleading comparison arrow
3. Activity Log tile currently shows "1 · Single task created in past week, no prior-week comparison available" — collapse the comparison sentence when the comparison adds nothing ("Single task created this week." is enough)

**Files:**
- `lib/prompts/portfolio-pulse.ts` (create if it doesn't exist)
- `components/horizon/PortfolioPulse.tsx` — add suppression logic

**Done when:**
- [ ] No Pulse tile displays a comparison where both values are < $100K
- [ ] Zero-value tiles show neutral labels, not misleading trends
- [ ] Every Pulse tile passes the "would a bank CFO nod at this?" test

---

### P1-3 — Strip raw Salesforce IDs from user-facing UI

**The problem:** The Pre-Drafted Actions cards show strings like `sf_WHO_ID:80%0A7000000JBkr0` visible next to task metadata. Breaks the premium-fintech illusion instantly.

**Fix:**
- Search the codebase for any rendering that includes `WHO_ID`, `WHAT_ID`, Salesforce ID patterns (`003*`, `005*`, `00T*`, `006*`), or the string `sf_`
- Either remove from the UI entirely or move to a `data-*` attribute that's used for backend wiring but not displayed
- Run the app and visually inspect every card on the home page — if you see an ID, fix it

**Done when:**
- [ ] No Salesforce IDs or URL-encoded strings visible anywhere on the home page
- [ ] IDs still attached to elements for action wiring (via `data-` attributes or component props)

---

### P1-4 — Fix seed data typos

**The problem:** The Live Signals feed shows `Graned Hotels & Resorts Ltd`. This is a seed-data typo ("Grand" → "Graned").

**Fix:**
- Search seed scripts and any static JSON in `public/seed/` for `Graned`
- Fix the typo and re-run `scripts/seed-data-cloud.ts --mode=all`
- Do a visual scan of ALL seed-generated names — anything else that looks off

**Done when:**
- [ ] No typos visible in Live Signals, Priority Queue, or anywhere else in rendered data
- [ ] Re-seeding produces clean output

---

### P1-5 — Timezone-correct clock

**The problem:** The top-right clock shows `4:00 AM`. If that's UTC at time of viewing and the banker is in Miami (ET), it's showing stale-looking time to viewers.

**Fix:**
- Detect the banker's timezone from the Salesforce user profile (`salesforce_crm.getUserInfo` returns `timeZoneSidKey`)
- Or read from `Intl.DateTimeFormat().resolvedOptions().timeZone` as fallback
- Render clock as `{Weekday}, {Month} {Day} · {h:mm} {AM/PM} {TZ abbreviation}` — e.g. `SUNDAY, APR 19 · 10:03 AM ET`

**Done when:**
- [ ] Clock displays banker's local time, not UTC
- [ ] Timezone abbreviation visible in the clock string
- [ ] The time shown matches what the banker's wall clock would show

---

### P1-6 — Priority Queue score readability

**The problem:** The Priority Queue shows numeric scores (95, 85, 70, 60, 45). These feel machine-generated and add visual noise without communicating meaning.

**Fix:**
- Replace numeric scores with qualitative tags: `Critical` (≥ 90), `Important` (70–89), `Watch` (< 70)
- Or remove the score column entirely — the ranked ORDER already communicates priority
- If retaining numbers, at minimum add a legend or tooltip explaining what the number represents

**Files:** `components/horizon/PriorityQueue.tsx`

**Done when:**
- [ ] Queue either uses qualitative tags OR explains what the numeric score means
- [ ] Visual weight is on the client name and context, not the score

---

### P1-7 — Voice playback: lock in pre-rendered audio

**The problem:** The "Listen" buttons on Morning Brief and Portfolio Pulse are critical for the video — Act 1 depends on the agent voice narrating the brief. Web Speech API quality varies by browser and OS; it CANNOT be relied upon for filming.

**Fix:**
- Integrate ElevenLabs API (or equivalent) for TTS generation
- After the Morning Brief JSON is generated, call ElevenLabs to produce an MP3 narration of greeting + items + signoff
- Cache the MP3 in Redis keyed by brief hash
- `<audio>` element plays the cached MP3 on Listen click
- Fallback to Web Speech if ElevenLabs fails (dev mode)

**Voice selection guidance:**
- Female, calm, mid-pitch, American English
- Test voices: "Rachel" or "Bella" in the ElevenLabs library are good starting points
- Speaking rate: 0.95x (slightly slower than default; this is fintech, not TikTok)

**Done when:**
- [ ] Clicking Listen produces a high-quality, pre-rendered audio narration
- [ ] Audio cached so a second click on the same brief is instant
- [ ] Voice tone matches the spec (calm, competent, slightly warm)

---

## 🟢 P2 — Stretch (only if P0 + P1 are green)

### P2-1 — Slack surface

A simple `/morning-brief` slash command that renders the same brief as Slack Block Kit cards. The video's Act 4 references this. Even a static-data version is fine for filming — judges won't know it's not dynamically regenerating.

### P2-2 — Live Signal Feed polish

The feed exists and looks good. Consider: add a subtle "pulse" animation to the newest signal as it streams in, grouping by time bucket ("Just now", "5 minutes ago"), and a 1-click "mark as read" that removes the signal.

### P2-3 — "Why this item?" drill-down

On Morning Brief hover, show a small popover: "This item was ranked #1 because [reason]." Makes the agent's ranking logic transparent. Optional but judges love transparency.

### P2-4 — Empty-state for quiet days

Currently not tested. What does Horizon render on a day when genuinely nothing matters? The signoff should handle this gracefully — "Today is quiet. Good time to catch up on relationship notes." — and the UI shouldn't feel broken.

---

## Validation Checklist (Run Before Every Filming Session)

Run these checks the morning of any filming day. Do not film if any P0 check fails.

```bash
# 1. MCP health
npx tsx scripts/verify-mcp.ts
# expect: all 3 servers PASS

# 2. Seed data fresh (< 24 hours)
stat public/seed/clients.json
# expect: mtime within 24h
# if stale: npx tsx scripts/seed-data-cloud.ts --mode=all

# 3. Demo moment data present
# Open Salesforce, query: SELECT Id, Name FROM Contact WHERE LastName IN ('Chen','Rodriguez','Patel','Vogel','Okafor','Brandt')
# expect: 6 rows

# 4. Production app health
curl -I https://headless-jdo-002d2a119b15.herokuapp.com/
# expect: 200 OK

# 5. Heroku dyno status
heroku ps --app headless-jdo-002d2a119b15
# expect: web dyno up, no recent restarts
```

### On-screen smoke test (5 minutes)

1. Open app in incognito → sign in → land on home page
2. Wait for Morning Brief to render — confirm ≥ 2 distinct MCP sources in chips
3. Click Listen → confirm pre-rendered audio plays cleanly
4. Focus the Ask Bar → speak or type: `"Show me clients who look like David Chen did three months before he left."`
5. Confirm streaming response + Reasoning Trail showing all 3 MCPs being called
6. Click Review on a drafted action → confirm sheet opens, data present
7. Click Send → confirm task creation in Salesforce + confirmation banner

If all 7 pass, you're ready to film.

---

## Commit strategy

- One commit per P0 task (4 commits expected)
- Bundle P1 tasks into 2–3 logical commits
- Tag `v1.0-demo-ready` when validation checklist passes end-to-end
- Tag `v1.0-submitted` after video upload on April 27

Good luck.

---

## Deferred ideas (post-submission)

Capturing here so we don't forget, but these are explicitly out of scope
until FIX_PASS P0 + P1 are green and the video is submitted.

### Kimi K2 Thinking as a second provider (decided 2026-04-18)

Heroku Inference now hosts `kimi-k2-thinking` on a separate add-on
(`inference-reticulated-65811`, toolkit token
`inf-81266d65-ea16-4933-9849-34665579f1e1`, MCP SSE transport at
`https://us.inference.heroku.com/mcp/sse`). Kimi K2 Thinking is an
open-weights MoE model tuned for agentic tool-calling with a 256k
context, notably faster and cheaper than Claude 4.5 Sonnet.

**Decision:** hold until post-submission. Rationale:
- 9 days to video (Apr 27); FIX_PASS has P0-3 + 7 P1 items open
- Routes where Kimi would help (`/api/drafts`, `/api/priority`,
  `/api/pulse`) already stream SSE with per-card loading states —
  latency is not the bottleneck the banker perceives
- Routes where speed *is* visible (`/api/brief` first paint,
  `/api/ask` streaming) are where Claude's prose polish most matters
- Adding a second provider touches `lib/llm/provider.ts` wiring and
  risks regressions near the freeze window

**Revisit after submission:** if Flex spend needs to come down,
narrowly scope Kimi to `/api/drafts` first as a try-before-buy.
Would require a thin `lib/llm/kimi.ts` mirroring `lib/llm/heroku.ts`
(~80% copy) and a per-route provider map in `lib/llm/provider.ts`.
