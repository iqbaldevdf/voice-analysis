# F11 — Dual audio storage (local vs S3)

**Status:** Implemented  
**Owner:** Backend  
**Related:** [F01](./F01-freshcaller-sync.md), [F02](./F02-call-analysis.md), [DEPLOYMENT.md §21](../../DEPLOYMENT.md)

## User story

As an operator, I want recordings stored on local disk in development and in private S3 in staging/production so durable audio survives VM rebuilds while ffmpeg/AI still read local paths.

## Rules

1. Switch: `S3_ENABLED=true` **and** `S3_AUDIO_BUCKET` set → S3 mode; otherwise **local-only** (current behaviour).
2. AI service always receives a **local filesystem** `audio_path` (never `s3://`).
3. Browser never talks to S3; playback streams through `GET /recordings/db/:callId/audio`.
4. Normalized WAVs are **local cache only** — not uploaded to S3.
5. S3 object key: `recordings/{callDate}/fc_{callId}_{recordingId}{ext}` using IST `callDate` when known.
6. Mongo may keep `localPath` as a cache hint; durable identity in S3 mode is `s3Bucket` + `s3Key`.
7. On cache miss in S3 mode: `GetObject` → `FC_RECORDINGS_DIR`. If no S3 object: re-download from Freshcaller, PUT S3, update Mongo.

## Acceptance criteria

- [x] AC1: With `S3_ENABLED=false`, sync/analyze/play behave as before (local disk only).
- [x] AC2: With S3 enabled, sync PUT originals to S3 and stores `s3Key` / `s3Bucket`.
- [x] AC3: `ensureLocalAudio` restores from S3 on local miss before re-hitting Freshcaller.
- [x] AC4: `/audio` streams from local cache or S3 (no public URL redirect).
- [x] AC5: List `hasLocalAudio` is true when local file exists **or** `s3Key` is set.
- [x] AC6: Spec + `.env.example` document the switch; secrets not committed.

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| GET | `/recordings/db/:callId/audio` | Stream from cache or S3 |
| (internal) | daily sync download | Optional S3 PUT |
| (internal) | analyze `ensureLocalAudio` | Optional S3 GET/PUT |

## Data model

| Collection | Field | Change |
| --- | --- | --- |
| `recordings` | `s3Bucket`, `s3Key` | New (nullable) |
| `recordings` | `localPath` | Cache path; optional after prune |
| `recording_listings` | `hasLocalAudio` | True if disk file or `s3Key` |

## Implementation notes

| File | Role |
| --- | --- |
| `backend/src/storage/audioStore.ts` | Local vs S3 helpers |
| `backend/src/services/analyzeRecording.ts` | ensureLocalAudio |
| `backend/src/freshcaller/dailySyncPipeline.ts` | Sync download |
| `backend/src/routes/dbRecordings.ts` | `/audio` |

## Open items

- Export ZIP PUT to S3 (`exports/` prefix) — later.
- Automatic cache prune after analyze — later.
- Backfill existing local files to S3 — ops script if needed.

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-21 | Initial implementation |
