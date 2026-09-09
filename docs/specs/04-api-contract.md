# API contract

Base URL: `http://127.0.0.1:5050` (backend).

## Health

| Method | Path | Response |
| --- | --- | --- |
| GET | `/health` | `{ ok, mongo, aiServiceUrl, freshcallerConfigured }` |

## Recordings (Mongo)

Prefix: **`/recordings/db`**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/listings` | Paginated list (preferred for UI) |
| GET | `/` | Full list from `recordings` collection |
| GET | `/:callId` | Detail + `analysisResult` |
| GET | `/:callId/audio` | Stream local audio |
| POST | `/:callId/analyze` | Run analysis once |
| PATCH | `/:callId` | Set/clear `disposition` |

### List query params (`/listings`)

| Param | Default | Description |
| --- | --- | --- |
| `excludeVoicemail` | `true` | Hide voicemails and calls ≤ 30s |
| `status` | all | `none`, `completed`, `running`, `failed` |
| `dateFrom`, `dateTo` | — | Filter on `createdTime` |
| `minDuration`, `maxDuration` | — | Seconds |
| `q` | — | Search agent, phone, customer, call id |
| `sortBy`, `sortDir` | `createdTime`, `desc` | |
| `page`, `limit` | 1, 10 | max limit 100 |

Response includes `voicemailMaxSec: 30`.

## Agents

Prefix: **`/agents`**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Agent roster |
| GET | `/:agentId` | Quarter summary + paginated recordings |
| POST | `/backfill` | Rebuild agents from recordings |

### Agent detail query params

| Param | Default | Description |
| --- | --- | --- |
| `quarter` | current IST | e.g. `2026-Q3` |
| `excludeVoicemail` | `true` | Table: connected only; KPIs use connects |
| `appointmentOnly` | `false` | AG filter |
| `status`, `dateFrom`, `dateTo`, `q` | — | Table filters |
| `sortBy`, `sortDir`, `page`, `limit` | | |

## Freshcaller sync

Prefix: **`/freshcaller/sync`**

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/status` | Cron config, last job, running state |
| GET | `/jobs` | Export job history |
| POST | `/run` | Manual sync for IST date |
| GET | `/logs` | Cron log lines |

## Legacy / dev

| Prefix | Notes |
| --- | --- |
| `/jobs` | File-based upload analyze (jobs.json) |
| `/freshcaller/exports` | In-memory export store (older UI path) |

New product features should use Mongo routes above unless spec says otherwise.

## Error conventions

| Code | When |
| --- | --- |
| 404 | Recording or agent not found |
| 409 | Sync or analysis already running |
| 422 | Voicemail / short call cannot be analyzed |

## AI service (internal)

| Method | Path | Body |
| --- | --- | --- |
| POST | `http://127.0.0.1:8001/analyze` | `{ audio_path, participant_context? }` |

Called only from backend, not from browser.
