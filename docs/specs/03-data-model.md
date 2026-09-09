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
| `disposition` | enum | `hung_up`, `not_interested`, `appointment`, `follow_up`, `dnc`, or null |
| `analysisStatus` | enum | `none`, `queued`, `running`, `completed`, `failed` |
| `analysisResult` | object | Full AI payload (large) |
| `localPath` | string | Path to downloaded audio |
| `recordingUrl` | string | Freshcaller URL |

**Indexes**: unique `(callId, recordingId)`; `callDate`, `agentId`, `analysisStatus`.

### `recording_listings` (projection)

Same metadata as list views need; **no** `analysisResult`. Kept in sync on write.

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
| `call_quality` | clarity_score, speech_rate_score |
| `participant_performance[]` | Agent row with overallScore + category scores |
| `speaker_metrics[]` | Talk time, words, WPM |
| `llm_sentiment` | Trajectory, emotions, risk flags |
| `ai_extraction` | summary, tags, call_outcome, action_items |

See F02 and [Call-and-Agent-Performance.md](../Call-and-Agent-Performance.md) for scoring fields.

## Disposition vs call outcome

| Stored on recording | Field | Set by |
| --- | --- | --- |
| Sales disposition | `disposition` | Reviewer (today); AI planned F04 |
| AI outcome | `analysisResult.ai_extraction.call_outcome` | AI on analyze |

## Backup / reset

- Full backup: `mongodump` + `backend/data/fc-recordings/` (see `backups/` folder pattern).
- Reset: drop DB + clear data dirs; re-sync from Freshcaller.
