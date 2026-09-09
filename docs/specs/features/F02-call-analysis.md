# F02 — Call analysis pipeline

**Status:** Implemented  
**Owner:** Backend + AI service  
**Related:** [Call-and-Agent-Performance.md](../../Call-and-Agent-Performance.md)

## User story

As a reviewer, I analyze a connect once and get transcript, scores, sentiment, and coaching notes.

## Rules

1. Analysis runs **at most once** per `(callId, recordingId)` unless failed retry.
2. Voicemail / ≤30s connects are rejected with 422 (F06).
3. Audio path: download → normalize 16 kHz mono → AI service.
4. Result stored in `recording.analysisResult`; status `completed`.
5. Agent stats refreshed after success.

## AI outputs

| Output | Used for |
| --- | --- |
| Transcript + diarization | UI, performance model |
| `call_quality` | Call score, agent call quality card |
| `participant_performance` | Agent performance score |
| `llm_sentiment` | Sentiment panels (not KPI scores) |
| `ai_extraction` | Summary, tags, **call_outcome** |

## Acceptance criteria

- [x] AC1: POST analyze returns stored result on repeat (reused).
- [x] AC2: Call quality uses clarity + speech rate (50/50).
- [x] AC3: Performance uses seven weighted categories when model succeeds.
- [x] AC4: Rate-limit on performance leaves call quality intact.
- [x] AC5: Call details page shows transcript and audio player.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/services/analyzeRecording.ts` | Orchestration |
| `ai-service/app/providers/assemblyai.py` | STT + LLM |
| `ai-service/app/participant_performance.py` | Scoring |
| `frontend/src/views/CallDetailsView.tsx` | UI |

## Open items

- Batch analyze from list (UI supports selected; verify limits in prod).
- Refactor STT → speaker mapping → LLM order per [F07](./F07-assemblyai-transcript-pipeline.md).
