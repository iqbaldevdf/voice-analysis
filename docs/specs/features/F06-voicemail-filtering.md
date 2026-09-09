# F06 — Voicemail & connect rules

**Status:** Implemented  
**Owner:** Backend

## Purpose

Define which calls count as **connects** for KPIs and which are hidden when **Hide voicemails** is on.

## Rules

1. **Freshcaller voicemail** (status 10/16 or lifecycle) → not a connect.
2. **Duration ≤ 30 seconds** → not a connect (even if Freshcaller marked answered).
3. **Forwarded mail / VM notes** in `callNotes` → excluded from history.
4. **Missed / not connected** → not a connect.

## Connect definition

A call is a connect when:

- `isVoicemail !== true`
- `durationSec > 30` (or duration unknown/null — kept visible in filter)
- Not forwarded-mail pattern in notes
- Classified connected at sync OR passes rules above on read

## Hide voicemails filter

When `excludeVoicemail=true` (default):

- Mongo filter excludes `isVoicemail: true`
- Mongo filter excludes `durationSec <= 30`

## Analyze rule

Calls failing connect rules cannot be analyzed (422).

## Acceptance criteria

- [x] AC1: ≤30s calls hidden with default filter.
- [x] AC2: Agent KPI connect counts exclude short/voicemail calls.
- [x] AC3: Sync skips audio download for non-connects.
- [x] AC4: `voicemailMaxSec: 30` returned in list API for UI label.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/voicemail.ts` | Core rules |
| `backend/src/freshcaller/connection.ts` | Sync-time classification |
| `backend/src/routes/agents.ts` | Connect filter for KPIs |

## Notes

Scoring doc §1 mentions ≤30s fallback when connected flag is missing; implementation also applies ≤30s when flag is present to avoid brief false connects.
