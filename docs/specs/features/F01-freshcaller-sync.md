# F01 — Freshcaller sync

**Status:** Implemented  
**Owner:** Backend  
**Related:** [02-architecture.md](../02-architecture.md), [04-api-contract.md](../04-api-contract.md)

## User story

As ops, I need calls from Freshcaller imported daily so reviewers can analyze them without manual export.

## Behaviour

1. **Cron**: `0 1 * * *` Asia/Kolkata — sync **previous IST calendar day**.
2. **Startup catch-up**: If yesterday was missed, run once on backend start.
3. **Manual**: Sync dashboard can trigger a date (`POST /freshcaller/sync/run`).
4. **Idempotency**: One `export_jobs` row per `callDate`; completed dates skip unless `force=true`.

## Pipeline phases

`export` → `poll` → `zip` → `index` → `download` → `complete`

- Parse `calls_*.json` from ZIP.
- Index all calls with `recording.url`.
- Classify connect vs voicemail (F06).
- Download audio only for non-voicemail connects.
- Upsert `recordings`, `recording_listings`, `agents`.

## Acceptance criteria

- [x] AC1: Sync status visible on `/sync` (running, last job, counts).
- [x] AC2: Cron logs searchable on `/logs`.
- [x] AC3: Duplicate date does not re-export without force.
- [x] AC4: Voicemail count reported on job (`voicemailSkipped`).
- [x] AC5: Only one sync runs at a time (409 if concurrent).

## Implementation

| File | Role |
| --- | --- |
| `backend/src/freshcaller/dailySyncPipeline.ts` | Main pipeline |
| `backend/src/freshcaller/cron.ts` | Scheduler |
| `backend/src/routes/freshcallerSync.ts` | HTTP API |
| `frontend/src/views/SyncDashboardView.tsx` | UI |

## Open items

- None.
