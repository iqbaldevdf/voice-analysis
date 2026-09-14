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

## Metric info tooltips

- Each KPI / metric label on call detail, agent detail, and agents list shows an **info icon** (hover or keyboard focus).
- Tooltip text explains how the value is calculated; copy lives in `frontend/src/lib/metricHelp.ts` and aligns with `docs/Call-and-Agent-Performance.md`.
- Agent detail KPI tooltips note that values are **quarter averages** across analyzed connects.

## Agents list page (`/agents`)

- **Quarter selector** (IST calendar quarter; defaults to current). Stats on cards and KPI row are scoped to the selected quarter.
- Query param `?quarter=YYYY-Qn` is shared with agent detail (e.g. `/agents/fc:123?quarter=2026-Q3`).
- Search by agent name.
- **Page KPI row:** Overall calls (total recordings), **Calls analyzed** as `analyzed / total` (e.g. `5 / 120`), roster overall score, roster appointments.
- **Agents table** columns: Agent (avatar + name), **Calls analyzed** as `analyzed / recordingCount`, **Overall score**, **Appointments**, **Open** action.
- Footer shows agent count and selected quarter label.
- No team name, coverage bar, pending counts, or last-call line.

## Agent detail page (F03)

**KPI row (current quarter, IST):** same six cards as call details — Overall Score, Talk/Listen, Avg Response Time, Silence, Interruptions, Speech rate — each averaged across analyzed connects. Overall Score subline shows `analyzed / connects`. Speech rate shows **words / minute** only (no score subline).

**Category break-up panel:** six behaviour scores in two side-by-side groups of three — **Communication skills** (Communication, Relevance, Listening) and **Engagement & outcomes** (Engagement, Balance, Efficiency). Turn taking is not shown. Plain quarter average per category.

**Filters:**

- Quarter selector
- Hide voicemails (connected only, ≤30s rule)
- Appointment generated (AG)
- Date range, status, duration, search

**Table columns:** When, Customer, Answered, Direction, Duration, Talk %, Speech rate, Disposition, Status, Call score, Analyze.

## Call details page (F02, F04)

**KPI row (first card):** **Overall Score** ring plus a 5-dot symbolic indicator (filled dots ∝ score; color green / amber / red). No Good/Fair text label. No clarity or speech-rate sublines on this card. Speech rate KPI shows **words / minute** only (no score subline on call or agent detail).

Sections: sentiment gauge, outcome panel (`Call Outcome` value + `Disposition` dropdown rows), recording player, transcript, performance panel, topics/tags.

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
