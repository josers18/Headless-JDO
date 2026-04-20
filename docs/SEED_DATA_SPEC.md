# Horizon — Seed Data Spec (P0-3)

> **Purpose:** Populate the JDO Salesforce org with the 6 synthetic clients and supporting FSC records that the Horizon demo depends on. The Ask Bar's Act 2 moment ("Show me clients who look like David Chen did three months before he left") only works when these rows exist and are joinable via native SOQL.
>
> **Audience:** An external seeding platform / agent with write access to the target Salesforce org.
>
> **Reference date:** All "N days ago" calculations assume **today = Saturday, April 18, 2026**. If you run this on a different date, adjust timestamps.

---

## What changed from the previous draft (and why you should care)

The first draft of this spec assumed the Horizon app reads from custom **Data Cloud DMOs** (`transactions__dlm`, `digital_engagement__dlm`, `life_events__dlm`). **That is wrong for this org.** I just probed the live target org via the Salesforce DX MCP and confirmed:

1. **The org has Financial Services Cloud (FSC) managed package installed**, with the following populated native objects (row counts as of this probe):
  - `FinServ__FinancialAccount__c` — **470 rows** (accounts, loans, brokerage, credit cards)
  - `FinServ__FinancialAccountTransaction__c` — **291 rows** (Debit / Credit transactions)
  - `FinServ__LifeEvent__c` — **139 rows** (New Job / New Home / New Business / New Baby / College / Retirement)
  - `Account`, `Contact` — **429+ rows** with rich FSC + `Cust360_*__pc` + `FINS_*__c` custom fields
2. **No Data Cloud seeding is required or wanted.** Data Cloud was the single biggest source of hallucinations in the FIX_PASS probes (DMO column guessing, `INFORMATION_SCHEMA`, `ssot__OwnerId__c`). Native SOQL against FSC objects is stable and joinable.
3. `**FinServ__FinancialAccount__c.FinServ__PrimaryOwner__c` is a lookup to `Account`, not Contact.** This is FSC's "person-account-as-household" pattern. Same for `FinServ__LifeEvent__c.FinServ__Client__c`.
4. **Valid enum values (verified against live data):**
  - `FinServ__FinancialAccountType__c`: `Checking`, `Savings`, `Brokerage`, `Credit Card`, `Term Loan`, `Mortgage`, `Managed Account`, `Line of Credit`, `CD`, `Cash Management Account`, `Retirement Account`, `529 Plan`, `Auto Loan`, `Mutual Fund`, `Treasury Service`, `Equipment Loan`, `Personal Loan`
  - `FinServ__TransactionType__c`: **only** `Debit` or `Credit`
  - `FinServ__TransactionSubtype__c`: `POS withdrawal`, `Fee`, `EFT`, `Merchant Charge`, `Wire`
  - `FinServ__EventType__c`: **only** `New Job`, `New Home`, `New Business`, `New Baby`, `College`, `Retirement`
5. **Banker user (you) Id = `005am000003PbCLAA0`** (`admin@finsdc3.demo`, "Jose Sifontes"). This is the `OwnerId` every seeded record must use so Horizon's "my clients" filter picks them up.

Every prompt below uses **real, verified field API names** and **valid picklist values only**. If your seeding platform hits an `INVALID_FIELD` or `INVALID_VALUE` error, stop and tell me — something has drifted from this spec; do not guess an alternative field name.

---

## Target org

- Salesforce My Domain: `https://storm-16a17dc388fbe6.demo.my.salesforce.com`
- Org Id: `00Dam00000Uo32qEAB`
- Banker username: `admin@finsdc3.demo` (Alias: `JDO`)
- Banker User Id: `005am000003PbCLAA0`

---

## Object & field cheat sheet

The Horizon Ask Bar will ask the `salesforce_crm` MCP questions that roughly become these SOQL queries. Every seeded record must be discoverable by at least one of them.

```sql
-- "Show me my clients"
SELECT Id, Name, Industry, Type, AnnualRevenue, Description,
       Cust360_ChurnRisk__pc, Cust360_Engagement_Score__pc,
       FINS_Assets_Under_Management__c, FINS_Client_Profile_Summary__c,
       FINS_Last_Transaction__c, FINS_Relationship_Plan__c
FROM Account
WHERE OwnerId = :bankerId AND Type = 'Person'

-- "Who looks like David Chen did before he left?" (lookalike cohort)
SELECT Id, Name, Cust360_Engagement_Score__pc, Cust360_ChurnRisk__pc,
       FINS_Assets_Under_Management__c, Industry
FROM Account
WHERE OwnerId = :bankerId
  AND Cust360_Engagement_Score__pc < 40
  AND Cust360_ChurnRisk__pc >= 60

-- "What transactions did David Chen make before he left?"
SELECT Id, Name, FinServ__Amount__c, FinServ__TransactionDate__c,
       FinServ__TransactionType__c, FinServ__TransactionSubtype__c,
       FinServ__Description__c, FinServ__FinancialAccount__r.Name,
       FinServ__FinancialAccount__r.FinServ__PrimaryOwner__r.Name
FROM FinServ__FinancialAccountTransaction__c
WHERE FinServ__FinancialAccount__r.FinServ__PrimaryOwner__c = :accountId
ORDER BY FinServ__TransactionDate__c DESC

-- "What life events should I know about for the Patels?"
SELECT Id, FinServ__EventType__c, FinServ__EventDate__c,
       FinServ__DiscussionNote__c, FinServ__Client__r.Name
FROM FinServ__LifeEvent__c
WHERE FinServ__Client__c = :accountId
ORDER BY FinServ__EventDate__c DESC
```

---

## Prompt 1 — Seed the 6 Person Accounts + Contacts

Paste verbatim into your external seeding platform.

```
Create 6 Person Account + Contact pairs in the Salesforce org with
My Domain https://storm-16a17dc388fbe6.demo.my.salesforce.com.

All records MUST be owned by User Id 005am000003PbCLAA0 (banker
admin@finsdc3.demo). Do NOT assign them to any other owner — the
Horizon app queries "WHERE OwnerId = :userId" and silently skips
rows owned by other users.

Reference date for "days ago" math: today = 2026-04-18.

For each pair:
  - Create the Account first
  - Create the Contact with AccountId = new Account Id
  - Verify both saved successfully before moving to the next pair
  - If any field fails with INVALID_FIELD, STOP and report the exact
    field name — do NOT substitute a similar-sounding field

────────────────────────────────────────────────────────────
Record 1 — David Chen  (anchor: former client, departed ~30 days ago)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Chen Family Trust"
    Type                               = "Other"
    Industry                           = "Financial Services"
    AnnualRevenue                      = 12400000
    Description                        = "HNW client. Departed approximately 30 days ago after an unexplained $2.1M wire to Fidelity Brokerage. Retained in org for lookalike-cohort modeling."
    BillingCity                        = "San Francisco"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 22
    Cust360_ChurnRisk__pc              = 95
    FINS_Assets_Under_Management__c    = 12400000
    FINS_Client_Profile_Summary__c     = "Former $12.4M HNW relationship. Large unexplained wire transfer preceded departure. Use as anchor for lookalike churn modeling."
    FINS_Relationship_Plan__c          = "Closed — retained for analytical reference."
    FINS_Last_Transaction__c           = 2026-03-19T14:12:00Z
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Chen Family Trust>
    FirstName     = "David"
    LastName      = "Chen"
    Email         = "david.chen@horizon-demo.example"
    Phone         = "+1 (415) 555-0142"
    MailingCity   = "San Francisco"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
Record 2 — Marcus Rodriguez  (at-risk lookalike — top alert)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Rodriguez Holdings"
    Type                               = "Other"
    Industry                           = "Financial Services"
    AnnualRevenue                      = 8700000
    Description                        = "HNW client, $8.7M AUM. Engagement down sharply in last 21 days. Matches David Chen's pre-departure behavioral pattern."
    BillingCity                        = "Palo Alto"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 31
    Cust360_ChurnRisk__pc              = 78
    FINS_Assets_Under_Management__c    = 8700000
    FINS_Client_Profile_Summary__c     = "HNW client, active relationship 8+ years. Recent engagement drop-off and shift in login patterns warrants proactive outreach this week."
    FINS_Relationship_Plan__c          = "At-risk — schedule proactive check-in call within 7 days."
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Rodriguez Holdings>
    FirstName     = "Marcus"
    LastName      = "Rodriguez"
    Email         = "marcus.rodriguez@horizon-demo.example"
    Phone         = "+1 (650) 555-0187"
    MailingCity   = "Palo Alto"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
Record 3 — Anika Patel  (life-event opportunity)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Patel Household"
    Type                               = "Other"
    Industry                           = "Healthcare"
    AnnualRevenue                      = 4200000
    Description                        = "Dual-income physician household. Daughter starting college in September — 529 funding conversation is timely."
    BillingCity                        = "Mountain View"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 71
    Cust360_ChurnRisk__pc              = 15
    FINS_Assets_Under_Management__c    = 4200000
    FINS_Client_Profile_Summary__c     = "Healthy engagement, long-tenure household. Upcoming life event (daughter beginning university) creates natural planning opportunity."
    FINS_Relationship_Plan__c          = "Scheduled 10 AM meeting Monday to discuss 529 contribution acceleration and liquidity plan."
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Patel Household>
    FirstName     = "Anika"
    LastName      = "Patel"
    Email         = "anika.patel@horizon-demo.example"
    Phone         = "+1 (408) 555-0163"
    MailingCity   = "Mountain View"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
Record 4 — Julia Nakamura  (second at-risk lookalike)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Nakamura Family Office"
    Type                               = "Other"
    Industry                           = "Technology"
    AnnualRevenue                      = 6100000
    Description                        = "Tech founder, $6.1M AUM. Engagement score has slipped from 82 to 34 over 60 days. Second clearest match to the Chen pattern."
    BillingCity                        = "Menlo Park"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 34
    Cust360_ChurnRisk__pc              = 72
    FINS_Assets_Under_Management__c    = 6100000
    FINS_Client_Profile_Summary__c     = "Former high-engagement client whose activity cadence has decayed materially over the last 60 days. Pattern matches the pre-departure behavior of a recently-lost relationship."
    FINS_Relationship_Plan__c          = "At-risk — next-best-action: send personal note and offer portfolio review."
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Nakamura Family Office>
    FirstName     = "Julia"
    LastName      = "Nakamura"
    Email         = "julia.nakamura@horizon-demo.example"
    Phone         = "+1 (650) 555-0194"
    MailingCity   = "Menlo Park"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
Record 5 — Ethan Brooks  (third at-risk lookalike, softer signal)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Brooks Revocable Trust"
    Type                               = "Other"
    Industry                           = "Healthcare"
    AnnualRevenue                      = 3800000
    Description                        = "Retired surgeon. Engagement has softened but not collapsed; recent large discretionary withdrawal. Partial match to Chen pattern."
    BillingCity                        = "Sausalito"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 38
    Cust360_ChurnRisk__pc              = 64
    FINS_Assets_Under_Management__c    = 3800000
    FINS_Client_Profile_Summary__c     = "Loyal long-term client with recent out-of-pattern withdrawal and declining digital engagement. Keep on watch; not yet escalation-worthy."
    FINS_Relationship_Plan__c          = "Watch — touch-base email in next 14 days."
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Brooks Revocable Trust>
    FirstName     = "Ethan"
    LastName      = "Brooks"
    Email         = "ethan.brooks@horizon-demo.example"
    Phone         = "+1 (415) 555-0175"
    MailingCity   = "Sausalito"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
Record 6 — Priya Venkatesh  (healthy control, for contrast)
────────────────────────────────────────────────────────────
  Account:
    OwnerId                            = 005am000003PbCLAA0
    Name                               = "Venkatesh Holdings"
    Type                               = "Other"
    Industry                           = "Technology"
    AnnualRevenue                      = 5500000
    Description                        = "Healthy, high-engagement client. Included in seed for contrast against at-risk cohort."
    BillingCity                        = "San Jose"
    BillingState                       = "CA"
    Cust360_Engagement_Score__pc       = 88
    Cust360_ChurnRisk__pc              = 8
    FINS_Assets_Under_Management__c    = 5500000
    FINS_Client_Profile_Summary__c     = "Highly engaged long-term client. Active portfolio, frequent login, recent positive NPS response."
    FINS_Relationship_Plan__c          = "Steady — quarterly review on schedule, no action needed this cycle."
  Contact:
    OwnerId       = 005am000003PbCLAA0
    AccountId     = <Id of Venkatesh Holdings>
    FirstName     = "Priya"
    LastName      = "Venkatesh"
    Email         = "priya.venkatesh@horizon-demo.example"
    Phone         = "+1 (408) 555-0131"
    MailingCity   = "San Jose"
    MailingState  = "CA"

────────────────────────────────────────────────────────────
After saving, report back the 6 Account Ids and 6 Contact Ids in a
table keyed by name. Those Ids are required for Prompt 2 and 3.
```

---

## Prompt 2 — Seed 3 Financial Accounts (Chen + Rodriguez + Nakamura)

Paste verbatim. **Only these three clients get `FinServ__FinancialAccount__c` records** — Patel, Brooks, Venkatesh do not need them for the demo.

```
Create 3 FinServ__FinancialAccount__c records in the same org.

Constraints on every record:
  - OwnerId                          = 005am000003PbCLAA0
  - FinServ__PrimaryOwner__c         = <AccountId from Prompt 1 for this client>
    (This is a lookup to Account, NOT Contact. Use the Account Id.)
  - FinServ__FinancialAccountType__c MUST be one of exactly these values
    (case-sensitive): Checking, Savings, Brokerage, Credit Card, Term Loan,
    Mortgage, Managed Account, Line of Credit, CD, Retirement Account.
    Any other value will be rejected.
  - FinServ__Status__c               = "Active" (or "Closed" for Chen)

────────────────────────────────────────────────────────────
FA 1 — David Chen's money-market account (the one he drained)
────────────────────────────────────────────────────────────
  Name                               = "Chen Trust — Premier Money Market"
  FinServ__PrimaryOwner__c           = <AccountId of "Chen Family Trust">
  FinServ__FinancialAccountType__c   = "Cash Management Account"
  FinServ__Balance__c                = 0
  FinServ__Status__c                 = "Closed"
  FinServ__OpenDate__c               = 2019-03-15
  FinServ__CloseDate__c              = 2026-03-20
  FinServ__FinancialAccountNumber__c = "MM-1042-CHEN"
  FinServ__Description__c            = "Legacy HNW cash management account. Zeroed out on 2026-03-19 via $2.1M wire to external brokerage; closed the following day."

────────────────────────────────────────────────────────────
FA 2 — Marcus Rodriguez's brokerage (still active, recent outflow)
────────────────────────────────────────────────────────────
  Name                               = "Rodriguez Holdings — Core Brokerage"
  FinServ__PrimaryOwner__c           = <AccountId of "Rodriguez Holdings">
  FinServ__FinancialAccountType__c   = "Brokerage"
  FinServ__Balance__c                = 6400000
  FinServ__Status__c                 = "Active"
  FinServ__OpenDate__c               = 2016-08-22
  FinServ__FinancialAccountNumber__c = "BR-2211-RODR"
  FinServ__Description__c            = "Primary brokerage account. Noticeable decrease in trading cadence and a $450K outbound wire in the last 14 days."

────────────────────────────────────────────────────────────
FA 3 — Julia Nakamura's managed account (still active)
────────────────────────────────────────────────────────────
  Name                               = "Nakamura Family Office — Managed Portfolio"
  FinServ__PrimaryOwner__c           = <AccountId of "Nakamura Family Office">
  FinServ__FinancialAccountType__c   = "Managed Account"
  FinServ__Balance__c                = 5900000
  FinServ__Status__c                 = "Active"
  FinServ__OpenDate__c               = 2020-01-10
  FinServ__FinancialAccountNumber__c = "MA-3388-NAKA"
  FinServ__Description__c            = "Discretionary managed portfolio. Three small withdrawals in the last 30 days (total ~$180K) — not alarming in isolation but matches pattern of a lost client."

Report back the 3 FinServ__FinancialAccount__c Ids keyed by client name.
These Ids are required for Prompt 3.
```

---

## Prompt 3 — Seed 5 Financial Account Transactions

Paste verbatim. The single most important row is **transaction T-Chen-1**, the $2.1M anomaly.

```
Create 5 FinServ__FinancialAccountTransaction__c records.

Hard rules — any violation = silent demo failure:
  - FinServ__TransactionType__c MUST be exactly "Debit" or "Credit".
    Nothing else is valid. The 291 existing rows use only those two values.
  - FinServ__TransactionSubtype__c should be one of (verified existing):
    "POS withdrawal", "Fee", "EFT", "Merchant Charge", "Wire".
  - FinServ__FinancialAccount__c is a required lookup — use the Ids
    from Prompt 2.
  - FinServ__TransactionDate__c is a DateTime (ISO-8601 with Z).
  - FinServ__Amount__c should be a positive number; direction is
    carried by FinServ__TransactionType__c (Debit = outflow).

────────────────────────────────────────────────────────────
T-Chen-1 — THE demo anomaly ($2.1M wire out, 30 days ago)
────────────────────────────────────────────────────────────
  FinServ__FinancialAccount__c       = <FA Id of "Chen Trust — Premier Money Market">
  FinServ__Amount__c                 = 2100000
  FinServ__TransactionType__c        = "Debit"
  FinServ__TransactionSubtype__c     = "Wire"
  FinServ__TransactionDate__c        = 2026-03-19T14:12:00Z
  FinServ__Description__c            = "Outbound wire transfer — Fidelity Brokerage (external). Note: first outbound wire of this magnitude from this account in 7+ years of account history."
  FinServ__TransactionStatus__c      = "Posted"

────────────────────────────────────────────────────────────
T-Chen-2 — Chen's routine monthly withdrawal (3 months ago, for lookalike matching baseline)
────────────────────────────────────────────────────────────
  FinServ__FinancialAccount__c       = <FA Id of "Chen Trust — Premier Money Market">
  FinServ__Amount__c                 = 18500
  FinServ__TransactionType__c        = "Debit"
  FinServ__TransactionSubtype__c     = "EFT"
  FinServ__TransactionDate__c        = 2026-01-15T10:00:00Z
  FinServ__Description__c            = "Recurring monthly distribution to personal checking."
  FinServ__TransactionStatus__c      = "Posted"

────────────────────────────────────────────────────────────
T-Rodriguez-1 — Marcus's $450K outbound (14 days ago, the "Chen-like" signal)
────────────────────────────────────────────────────────────
  FinServ__FinancialAccount__c       = <FA Id of "Rodriguez Holdings — Core Brokerage">
  FinServ__Amount__c                 = 450000
  FinServ__TransactionType__c        = "Debit"
  FinServ__TransactionSubtype__c     = "Wire"
  FinServ__TransactionDate__c        = 2026-04-04T15:30:00Z
  FinServ__Description__c            = "Outbound wire — external brokerage. Unusual relative to 36-month trailing volume."
  FinServ__TransactionStatus__c      = "Posted"

────────────────────────────────────────────────────────────
T-Rodriguez-2 — Marcus's routine wire (1 year ago, for baseline)
────────────────────────────────────────────────────────────
  FinServ__FinancialAccount__c       = <FA Id of "Rodriguez Holdings — Core Brokerage">
  FinServ__Amount__c                 = 25000
  FinServ__TransactionType__c        = "Debit"
  FinServ__TransactionSubtype__c     = "EFT"
  FinServ__TransactionDate__c        = 2025-04-18T11:00:00Z
  FinServ__Description__c            = "Quarterly distribution to tax-reserve account."
  FinServ__TransactionStatus__c      = "Posted"

────────────────────────────────────────────────────────────
T-Nakamura-1 — Julia's small cluster withdrawal (7 days ago, softer signal)
────────────────────────────────────────────────────────────
  FinServ__FinancialAccount__c       = <FA Id of "Nakamura Family Office — Managed Portfolio">
  FinServ__Amount__c                 = 65000
  FinServ__TransactionType__c        = "Debit"
  FinServ__TransactionSubtype__c     = "EFT"
  FinServ__TransactionDate__c        = 2026-04-11T09:45:00Z
  FinServ__Description__c            = "Third discretionary withdrawal this month — total withdrawn ~$180K, outside 12-month trailing norm."
  FinServ__TransactionStatus__c      = "Posted"

Report back the 5 transaction Ids keyed by the T-* labels above.
```

---

## Prompt 4 — Seed 1 Life Event (Anika Patel)

Paste verbatim.

```
Create 1 FinServ__LifeEvent__c record.

Constraints:
  - FinServ__Client__c is a lookup to Account (not Contact). Use the
    Patel Household Account Id from Prompt 1.
  - FinServ__EventType__c MUST be one of EXACTLY these values
    (case-sensitive, verified against 139 existing rows):
      "New Job", "New Home", "New Business", "New Baby",
      "College", "Retirement"
    No other values are allowed. For Patel's "daughter starting
    college" scenario, use "College".

────────────────────────────────────────────────────────────
LE-Patel-1 — Daughter starting university
────────────────────────────────────────────────────────────
  OwnerId                            = 005am000003PbCLAA0
  FinServ__Client__c                 = <AccountId of "Patel Household">
  FinServ__EventType__c              = "College"
  FinServ__EventDate__c              = 2026-09-03
  FinServ__DiscussionNote__c         = "Daughter Maya begins freshman year at Stanford this September. Review 529 distribution schedule, tuition cash-flow plan, and emergency-liquidity position. Client asked to discuss accelerating final-year 529 contribution before fall."

Report back the 1 life-event Id.
```

---

## Prompt 5 — Final validation (run and paste the output back)

Paste verbatim into your external seeding platform.

```
Run these SIX verification queries against the same Salesforce org
and paste the full results back. Do NOT attempt to fix any
discrepancy yourself — I will review and decide.

Query A (6 person accounts owned by banker):
  SELECT Id, Name, Cust360_Engagement_Score__pc, Cust360_ChurnRisk__pc,
         FINS_Assets_Under_Management__c
  FROM Account
  WHERE OwnerId = '005am000003PbCLAA0'
    AND Name IN (
      'Chen Family Trust', 'Rodriguez Holdings', 'Patel Household',
      'Nakamura Family Office', 'Brooks Revocable Trust',
      'Venkatesh Holdings'
    )
  ORDER BY Name

Query B (6 matching contacts):
  SELECT Id, FirstName, LastName, AccountId, Account.Name
  FROM Contact
  WHERE OwnerId = '005am000003PbCLAA0'
    AND LastName IN ('Chen','Rodriguez','Patel','Nakamura','Brooks','Venkatesh')
  ORDER BY LastName

Query C (3 financial accounts):
  SELECT Id, Name, FinServ__FinancialAccountType__c, FinServ__Balance__c,
         FinServ__Status__c, FinServ__PrimaryOwner__r.Name
  FROM FinServ__FinancialAccount__c
  WHERE FinServ__PrimaryOwner__r.OwnerId = '005am000003PbCLAA0'
    AND FinServ__PrimaryOwner__r.Name IN (
      'Chen Family Trust', 'Rodriguez Holdings', 'Nakamura Family Office'
    )
  ORDER BY FinServ__PrimaryOwner__r.Name

Query D (5 transactions, Chen anomaly should be first):
  SELECT Id, Name, FinServ__Amount__c, FinServ__TransactionType__c,
         FinServ__TransactionSubtype__c, FinServ__TransactionDate__c,
         FinServ__FinancialAccount__r.Name,
         FinServ__FinancialAccount__r.FinServ__PrimaryOwner__r.Name,
         FinServ__Description__c
  FROM FinServ__FinancialAccountTransaction__c
  WHERE FinServ__FinancialAccount__r.FinServ__PrimaryOwner__r.OwnerId = '005am000003PbCLAA0'
    AND FinServ__FinancialAccount__r.FinServ__PrimaryOwner__r.Name IN (
      'Chen Family Trust', 'Rodriguez Holdings', 'Nakamura Family Office'
    )
  ORDER BY FinServ__Amount__c DESC

Query E (Patel life event):
  SELECT Id, FinServ__Client__r.Name, FinServ__EventType__c,
         FinServ__EventDate__c, FinServ__DiscussionNote__c
  FROM FinServ__LifeEvent__c
  WHERE FinServ__Client__r.OwnerId = '005am000003PbCLAA0'
    AND FinServ__Client__r.Name = 'Patel Household'

Query F (lookalike-cohort filter — THE Act 2 demo query):
  SELECT Id, Name, Cust360_Engagement_Score__pc, Cust360_ChurnRisk__pc,
         FINS_Assets_Under_Management__c
  FROM Account
  WHERE OwnerId = '005am000003PbCLAA0'
    AND Cust360_Engagement_Score__pc < 40
    AND Cust360_ChurnRisk__pc >= 60
    AND Name != 'Chen Family Trust'
  ORDER BY Cust360_ChurnRisk__pc DESC

Expected outcomes:
  A: 6 rows
  B: 6 rows
  C: 3 rows
  D: 5 rows, with the Chen $2,100,000 wire as the first row
  E: 1 row with "College" as FinServ__EventType__c
  F: 3 rows (Rodriguez Holdings, Nakamura Family Office, Brooks
     Revocable Trust), Rodriguez with the highest ChurnRisk

If any row count is wrong, paste the actual results and stop.
Do NOT re-run the seed prompts without my explicit approval.
```

---

## Why these fields & values are safe (self-audit)

Every field below was verified to exist in the target org via a live Tooling-API schema probe before inclusion in this spec:

**Account:**

- Standard: `OwnerId`, `Name`, `Type`, `Industry`, `AnnualRevenue`, `Description`, `BillingCity`, `BillingState`
- Cust360 (person account): `Cust360_Engagement_Score__pc`, `Cust360_ChurnRisk__pc`
- Demo custom: `FINS_Assets_Under_Management__c`, `FINS_Client_Profile_Summary__c`, `FINS_Relationship_Plan__c`, `FINS_Last_Transaction__c`

**Contact:**

- Standard: `OwnerId`, `AccountId`, `FirstName`, `LastName`, `Email`, `Phone`, `MailingCity`, `MailingState`

**FinServ__FinancialAccount__c:**

- `OwnerId`, `Name`, `FinServ__PrimaryOwner__c` (lookup → Account), `FinServ__FinancialAccountType__c`, `FinServ__Balance__c`, `FinServ__Status__c`, `FinServ__OpenDate__c`, `FinServ__CloseDate__c`, `FinServ__FinancialAccountNumber__c`, `FinServ__Description__c`

**FinServ__FinancialAccountTransaction__c:**

- `FinServ__FinancialAccount__c` (lookup), `FinServ__Amount__c`, `FinServ__TransactionType__c`, `FinServ__TransactionSubtype__c`, `FinServ__TransactionDate__c`, `FinServ__Description__c`, `FinServ__TransactionStatus__c`

**FinServ__LifeEvent__c:**

- `OwnerId`, `FinServ__Client__c` (lookup → Account), `FinServ__EventType__c`, `FinServ__EventDate__c`, `FinServ__DiscussionNote__c`

**Picklist values** for every enum-type field above were taken from the live distribution of 291 existing transactions, 470 financial accounts, and 139 life events in this specific org — so they are guaranteed to be accepted.

---

## Fields this spec deliberately does **NOT** use

If your seeding platform suggests any of these, reject them — they do not exist in this org:

- `AUM__c`, `Churn_Risk__c`, `Engagement_Score__c`, `Health_Score__c`, `Risk_Score__c` (no namespace — all fake)
- `SegmentTier`, `SegmentTier__c`
- `TransactionDate__c`, `Transaction_Date__c` (real is `FinServ__TransactionDate__c`)
- `transactions__dlm`, `digital_engagement__dlm`, `life_events__dlm` (no Data Cloud DMOs are needed; do not create any)
- Any `ssot`__* columns — those are Data Cloud DMO columns, out of scope for this seed
- `Industry__c` (use standard `Industry` instead)
- `FinancialAccountType` (no namespace — use `FinServ__FinancialAccountType__c`)
- `TransactionType` (no namespace — use `FinServ__TransactionType__c`)
- Any `FinServ__EventType__c` value other than the six allowed (e.g. "Child Engagement", "Daughter Engaged", "Wedding" — not valid in this org)

