# Data model

Database: **`voice_analysis`** (MongoDB).

## Collections

### `recordings` (canonical)

One document per Freshcaller call + recording pair.

| Field | Type | Notes |
| --- | --- | --- |
| `callId` | number | Freshcaller call id |
| `recordingId` | number | Freshcaller recording id |
| `agentId` | string | e.g. `fc:123` or `name:…` |
| `agentName` | string | |
| `createdTime` | string | ISO from Freshcaller |
| `callDate` | string | `YYYY-MM-DD` IST |
| `durationSec` | number | |
| `direction` | string | incoming / outgoing |
| `isVoicemail` | boolean | From classification |
| `isConnected` | boolean | Live conversation flag |
| `botHandling` | enum | `none`, `bot_only`, `bot_transferred` (F09) |
| `isBotInvolved` | boolean | True when botHandling ≠ `none` |
| `disposition` | enum | `hung_up`, `not_interested`, `appointment`, `follow_up`, `dnc`, or null |
| `analysisStatus` | enum | `none`, `queued`, `transcribing`, `running`, `awaiting_transcript_review`, `completed`, `failed` |
| `analysisResult` | object | Full AI payload (large); may include `bot_segment` (F09) and F10 `call_quality.audio_clarity_*` |
| `localPath` | string | Local cache path to downloaded audio (may be empty after prune in S3 mode) |
| `localFileName` | string | Basename of cached file |
| `s3Bucket` | string | F11: private audio bucket when `S3_ENABLED` |
| `s3Key` | string | F11: e.g. `recordings/2026-09-18/fc_9064160_5384090.mp3` |
| `recordingUrl` | string | Freshcaller URL |

**Indexes**: unique `(callId, recordingId)`; `callDate`, `agentId`, `analysisStatus`.

### `recording_listings` (projection)

Same metadata as list views need; **no** `analysisResult`. Kept in sync on write. Includes `audioClarityFlag` (`ok` \| `caution` \| `poor` \| null) for the F10 list badge. `hasLocalAudio` is true when a local cache file path exists **or** `s3Key` is set (F11).

### `agents`

| Field | Type | Notes |
| --- | --- | --- |
| `agentId` | string | Unique |
| `name` | string | |
| `callCount` | number | Derived |
| `recordingCount` | number | Derived |
| `analyzedCount` | number | Derived |
| `averageScore` | number | Agent performance average (legacy list) |
| `firstCallAt` / `lastCallAt` | string | ISO |

### `export_jobs`

One row per **IST call date** synced (unique `callDate`).

Tracks phases: export → poll → zip → index → download → complete.

### `cron_job_logs`

Structured log lines per sync run. TTL ~90 days (`CRON_LOG_TTL_DAYS`).

## Analysis result shape (summary)

Stored under `recording.analysisResult`:

| Section | Purpose |
| --- | --- |
| `call_quality` | clarity_score, speech_rate_score; F10: `audio_clarity_flag`, `speaker_audio_clarity[]`, `audio_clarity_reasons`, `avg_asr_confidence`, `low_confidence_word_pct`, `low_confidence_spans` |
| `participant_performance[]` | Agent row with overallScore + category scores |
| `speaker_metrics[]` | Talk time, words, WPM |
| `llm_sentiment` | Trajectory, emotions, risk flags |
| `ai_extraction` | summary, tags, call_outcome, action_items |
| `transcript_review` | Dual STT passes, WER, similarity, review status (F08) |
| `speaker_validation` | Optional audio diarization audit summary (F07 Stage 3b): `profile_status`, `profile_quality[]`, `profile_separation`, island/boundary/long-turn counters, `timing_ms` |
| `processing_version` | Pipeline version string (e.g. `2.0.0`) |

See F02 and [Call-and-Agent-Performance.md](../Call-and-Agent-Performance.md) for scoring fields.

## Disposition vs call outcome

| Stored on recording | Field | Set by |
| --- | --- | --- |
| Sales disposition | `disposition` | Reviewer (today); AI planned F04 |
| AI outcome | `analysisResult.ai_extraction.call_outcome` | AI on analyze |

## Backup / reset

- Full backup: `mongodump` + `backend/data/fc-recordings/` (see `backups/` folder pattern).
- Reset: drop DB + clear data dirs; re-sync from Freshcaller.
