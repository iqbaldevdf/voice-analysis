# F07 — Introduction script compliance

**Status:** Implemented  
**Owner:** AI service + Frontend + Backend

## User story

As a team lead, I want to see whether agents cover the **Datafortune customer introduction** in the opening of the call, scored with flexible similar-word matching (not exact script reading).

## Company pitch themes (4 groups)

1. **Datafortune & AI-first positioning** — company name, AI-first, engineering solutions, competitive advantage  
2. **Core expertise** — application/product engineering, data management, business intelligence  
3. **Engagement model** — flexible engagement, scale capacity, dedicated / AI-enabled engineers  
4. **Delivery ownership** — end-to-end ownership, solution engineering, delivery & execution  

## Rules

1. Only **agent speech** in the **first ~120 seconds** (or first 10 agent turns) is reviewed.
2. Each theme is **matched** if any configured phrase (or similar wording) appears — substring match, case-insensitive.
3. **Score** = themes matched ÷ 4 × 100 (0–100).
4. **Rank**: Excellent ≥80, Good ≥60, Fair ≥40, Needs work &lt;40.
5. Does not change agent performance score or call quality — separate metric.
6. Stored on `analysisResult.introduction_script` after Analyze.

## Acceptance criteria

- [x] AC1: Analyze produces `introduction_script` with score, rank, themes, evidence.
- [x] AC2: Call details shows Introduction script panel with matched/missed themes.
- [ ] AC3: Agent page has Introduction script KPI card (quarter average) — not in current agent UI.
- [ ] AC4: Agent recording table has Intro column per call — removed; intro remains on call details only.
- [ ] AC5: Configurable phrase list via env/file (future).

## Implementation

| File | Role |
| --- | --- |
| `ai-service/app/introduction_script.py` | Phrase themes + scoring |
| `ai-service/app/schemas.py` | `IntroductionScriptScore` model |
| `backend/src/scoring/agentQuarter.ts` | Extract intro from result |
| `backend/src/routes/agents.ts` | Quarter average + row field |
| `frontend/src/components/IntroductionScriptPanel.tsx` | Call details UI |

## Backfill (existing analyses)

Completed recordings stored **before** F07 may lack `introduction_script`. On **GET** `/recordings/db/:callId` (with analysis) and on **agent recordings** load, the backend calls AI `POST /score-introduction-script` from stored utterances + speaker mapping, persists the result, then returns it (no full re-analyze).

## Re-analyze

Existing analyzed calls do not have intro scores until **re-analyzed**.

## Config (optional)

- `INTRO_OPENING_MAX_SEC` (default 120)  
- `INTRO_MAX_AGENT_TURNS` (default 10)
