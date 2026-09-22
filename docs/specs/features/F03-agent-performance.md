# F03 — Agent performance & quarterly KPIs

**Status:** Implemented  
**Owner:** Backend + Frontend  
**Canonical formulas:** [Call-and-Agent-Performance.md](../../Call-and-Agent-Performance.md)

## User story

As a team lead, I see each agent’s averages for the **current calendar quarter (IST)** and drill into calls.

## KPI cards (per selected quarter)

Same six cards as call details; each value is the **average across analyzed connects** in the selected quarter:

| Card | Calculation |
| --- | --- |
| Overall Score | Mean call-quality score (clarity + speech rate) per analyzed connect |
| Talk / Listen Ratio | Mean agent and customer talk % from speaker metrics |
| Avg Response Time | Mean `call_quality.avg_response_time_sec` |
| Silence (Total) | Mean silence % and seconds |
| Interruptions | Mean `call_quality.interruptions_count` |
| Speech rate | Mean agent words/min (from words/sec × 60); no score subline in UI |

Overall Score subline: `analyzed / connects` (e.g. `5 / 12`).

## Quarter rules

- Quarters: Q1–Q4 in Asia/Kolkata (see glossary).
- Page opens on **current** quarter.
- Changing quarter recalculates all cards; **no data is deleted**.
- Category break-up panel: six categories in two groups of three (Communication skills; Engagement & outcomes). Turn taking is omitted from the UI. Plain average per category across scored connects.

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

## Related UI (agent recordings table)

- Dedicated **Bot** column (F09 AC4c): `Bot → Agent` / `Bot handled` / `No` — Freshcaller sync first, else analysis `bot_segment` when analyzed.
- **Talk** and **Script** are separate columns (no interruptions count in this table).
- **Script** cell shows `score/100` (and rank when present); hover title is `Introduction script: N out of 100`.
- Customer cell prefers a single line; table uses available horizontal width.
