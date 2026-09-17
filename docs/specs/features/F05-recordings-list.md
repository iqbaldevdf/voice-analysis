# F05 — Recordings list & filters

**Status:** Implemented  
**Owner:** Frontend + Backend

## User story

As a reviewer, I browse synced calls, filter noise, sort, and open or batch-analyze.

## Routes

- `/recordings` — primary list (date query param supported).
- `/meetings` — same component, different mode label.

## Default filters

- **Hide voicemails** on by default (`excludeVoicemail=true`).
- Excludes voicemails and calls **≤ 40 seconds** (F06).

## List capabilities

- Search, status, date range, min/max duration.
- Sort by date (default desc), duration, agent, status.
- Pagination.
- Select rows → Analyze selected.
- Open row → call details.

## Acceptance criteria

- [x] AC1: List loads from `/recordings/db/listings`.
- [x] AC2: Hide voicemails removes ≤40s and voicemail rows.
- [x] AC3: Analyze triggers POST analyze per call.
- [x] AC4: Empty state when no data or filters too tight.

## Implementation

| File | Role |
| --- | --- |
| `frontend/src/views/CallsListView.tsx` | UI |
| `backend/src/routes/dbRecordings.ts` | List API |
| `backend/src/db/recordingListings.ts` | Projection |

## Open items

- Disposition column on main recordings list (optional enhancement).
