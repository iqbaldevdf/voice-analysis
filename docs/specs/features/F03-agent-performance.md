# F03 — Agent performance & quarterly KPIs

**Status:** Implemented  
**Owner:** Backend + Frontend  
**Canonical formulas:** [Call-and-Agent-Performance.md](../../Call-and-Agent-Performance.md)

## User story

As a team lead, I see each agent’s averages for the **current calendar quarter (IST)** and drill into calls.

## KPI cards (per selected quarter)

| Card | Calculation |
| --- | --- |
| Performance | Mean of agent `overallScore` on analyzed connects with a score |
| Call quality | Mean of call quality on analyzed connects |
| Calls processed (connects) | Count of connects in quarter; subline = analyzed count |
| Speech rate | Mean agent words/sec on analyzed connects |

## Quarter rules

- Quarters: Q1–Q4 in Asia/Kolkata (see glossary).
- Page opens on **current** quarter.
- Changing quarter recalculates all cards; **no data is deleted**.
- Category averages panel: plain average per category across scored connects.

## Filters affecting KPIs + table

| Filter | Effect |
| --- | --- |
| Quarter | Scope all metrics |
| Appointment generated | Only `disposition === appointment` |
| Hide voicemails | Table shows connects only; KPIs already use connects |

## Acceptance criteria

- [x] AC1: Four KPI cards match scoring doc formulas.
- [x] AC2: Quarter selector lists recent quarters.
- [x] AC3: AG filter limits cards and table to appointments.
- [x] AC4: Call score column shows call quality not performance.
- [x] AC5: Unanalyzed connects count toward connects but not averages.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/routes/agents.ts` | Aggregation |
| `backend/src/scoring/agentQuarter.ts` | Quarter + quality math |
| `frontend/src/views/AgentDetailView.tsx` | UI |

## Open items

- None.
