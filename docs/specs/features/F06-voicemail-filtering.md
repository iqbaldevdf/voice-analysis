# F06 — Voicemail & connect rules

**Status:** Implemented  
**Owner:** Backend

## Purpose

Define which calls count as **connects** for KPIs and which are hidden when **Hide voicemails** is on.

## Freshcaller status source

Official participant `call_status` values from [Freshcaller API](https://developers.freshcaller.com/api/):

| Status | Meaning | Our use |
| --- | --- | --- |
| **10** | The call was redirected to a voicemail | `isVoicemail = true` |
| **16** | The voicemail recording was in progress | `isVoicemail = true` |
| **19** | The call is handled by a bot | See [F09](./F09-bot-call-handling.md) (`bot_only` / `bot_transferred`) |
| **1** / **15** | Answered/Completed / completed recently | Connected signal |
| Lifecycle `*voicemail*` (e.g. `voicemail_initiated`) | Voicemail path | `isVoicemail = true` |

**Important:** We do **not** filter voicemails via a Freshcaller query parameter (none is documented). We read `participants[].call_status` / `life_cycle` from export or `GET /api/v1/calls`, then classify in `classifyFreshcallerCall()`.

## Rules

1. **Freshcaller voicemail** (participant `call_status` **10** or **16**, or voicemail lifecycle) → `isVoicemail: true`, not a connect.
2. **Duration ≤ 40 seconds** → not a connect (even if Freshcaller marked answered). This does **not** rewrite `isVoicemail` when Freshcaller status is present; UI hide still applies ≤40s.
3. **Forwarded mail / VM notes** in `callNotes` → excluded from history.
4. **Missed / not connected** → not a connect.
5. **Bot only** (`call_status` **19** with no human answered/connected) → not a connect (F09). **Bot → agent transfer** remains a connect when F06 duration/voicemail rules pass.

## Connect definition

A call is a connect when:

- `isVoicemail !== true` (Freshcaller status 10/16 or voicemail lifecycle)
- `durationSec > 40` (or duration unknown/null — kept visible in filter)
- Not forwarded-mail pattern in notes
- Classified connected at sync OR passes rules above on read

## Hide voicemails filter

When `excludeVoicemail=true` (default):

- Mongo filter excludes `isVoicemail: true` (status 10/16 / lifecycle)
- Mongo filter excludes `durationSec <= 40`

## Analyze rule

Calls failing connect rules cannot be analyzed (422).

## Acceptance criteria

- [x] AC1: ≤40s calls hidden with default filter.
- [x] AC2: Agent KPI connect counts exclude short/voicemail calls.
- [x] AC3: Sync skips audio download for non-connects.
- [x] AC4: `voicemailMaxSec: 40` returned in list API for UI label.
- [x] AC5: `isVoicemail` is set from Freshcaller `call_status` 10/16 (or voicemail lifecycle), not invented from duration when status exists.
- [x] AC6: Sync uses the same classification for export ZIP and `GET /api/v1/calls` fallback.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/voicemail.ts` | Duration / notes / list Mongo filters |
| `backend/src/freshcaller/connection.ts` | Sync-time classification from Freshcaller statuses |
| `backend/src/routes/agents.ts` | Connect filter for KPIs |

## Notes

Scoring doc §1 mentions ≤30s fallback when connected flag is missing; list/connect hide uses ≤40s (`VOICEMAIL_MAX_DURATION_SEC`) per product rule.
