# UI routes

Frontend: `http://127.0.0.1:5173` (Vite).

## Navigation map

| Route | View | Spec |
| --- | --- | --- |
| `/` | Redirect → `/recordings` | |
| `/recordings` | Calls list (recordings mode) | F05 |
| `/recordings/:callId/:recordingId` | Call details | F02, F04 |
| `/meetings` | Calls list (meetings mode) | F05 |
| `/agents` | Agent roster | F03 |
| `/agents/:agentId` | Agent detail + KPI cards | F03, F04 |
| `/sync` | Sync dashboard | F01 |
| `/logs` | Cron logs | F01 |

## Global shell

- **AppShell**: top nav links (Recordings, Agents, Sync, Logs).
- Error banner for API failures.

## Agent detail page (F03)

**KPI row (current quarter, IST):**

| Card | Metric |
| --- | --- |
| Performance | Avg agent performance (scored connects only) |
| Call quality | Avg call quality; subline clarity + speech rate |
| Calls processed (connects) | Count connects; subline analyzed count |
| Speech rate | Avg words/sec |

**Filters:**

- Quarter selector
- Hide voicemails (connected only, ≤30s rule)
- Appointment generated (AG)
- Date range, status, duration, search

**Table columns:** When, Customer, Answered, Direction, Duration, Talk %, Speech rate, Disposition, Status, Call score, Analyze.

## Call details page (F02, F04)

Sections: sentiment gauge, call outcome, disposition dropdown, recording player, transcript, performance panel, topics/tags.

## Disposition colours

CSS classes: `disposition-hung_up`, `disposition-not_interested` (yellow), `disposition-appointment` (dark green), `disposition-follow_up` (light green), `disposition-dnc` (blue).

See [00-glossary.md](./00-glossary.md).

## Implementation files

| Area | Primary files |
| --- | --- |
| Routes | `frontend/src/App.tsx` |
| Recordings list | `frontend/src/views/CallsListView.tsx` |
| Agent detail | `frontend/src/views/AgentDetailView.tsx` |
| Call details | `frontend/src/views/CallDetailsView.tsx` |
| Sync | `frontend/src/views/SyncDashboardView.tsx` |
| API client | `frontend/src/api.ts` |
| Disposition helpers | `frontend/src/lib/disposition.ts` |
