# Product overview

## Problem

Sales call centers need to review recordings, score agent behaviour, and track outcomes (appointments, follow-ups, DNC) without manual spreadsheet work.

## Solution

VoiceIQ syncs calls from **Freshcaller**, analyzes audio with **AssemblyAI**, and presents:

- Recording lists with filters
- Call detail dashboards (transcript, sentiment, KPIs)
- Per-agent quarterly performance cards
- Sync status and cron logs

## Users

| User | Primary actions |
| --- | --- |
| **Reviewer / QA** | Filter calls, analyze, set disposition, read coaching notes |
| **Team lead** | Agent page: quarter KPIs, category averages, AG filter |
| **Ops** | Sync dashboard, cron logs, re-sync dates |

## Core user journeys

### J1 — Daily operations (automatic)

1. Cron runs at 01:00 Asia/Kolkata for previous IST day.
2. Export job pulls calls with recordings.
3. Voicemails skipped; connects indexed and audio downloaded.
4. Reviewer analyzes calls from **Recordings** or **Agent** page.

### J2 — Review one call

1. Open recording from list or agent table.
2. Click **Analyze** (once per call).
3. View transcript, sentiment, call quality, performance scores.
4. Set **disposition** (manual today; AI auto-set planned in F04).

### J3 — Agent quarterly review

1. Open **Agents** → select agent.
2. Quarter selector defaults to current quarter (IST).
3. Cards show averages for that quarter only.
4. Optional: **Appointment generated** filter.
5. Optional: **Hide voicemails** on recording table.

## Non-goals (current)

- Real-time live call monitoring
- Multi-tenant RBAC
- Customer-facing portal
- Replacing Freshcaller as system of record

## Success metrics (product)

- Connects synced per day without duplicate export jobs
- % of connects analyzed per quarter
- Disposition coverage (target: auto or manual on every analyzed connect)
