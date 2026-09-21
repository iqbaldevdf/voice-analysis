# F02 — Call analysis pipeline

**Status:** Implemented  
**Owner:** Backend + AI service  
**Related:** [Call-and-Agent-Performance.md](../../Call-and-Agent-Performance.md)

## User story

As a reviewer, I analyze a connect once and get transcript, scores, sentiment, and coaching notes.

## Rules

1. Analysis runs **at most once** per `(callId, recordingId)` unless failed retry or **force re-analyze**.
2. Voicemail / ≤30s connects are rejected with 422 (F06).
3. Audio path: download → normalize 16 kHz mono → AI service.
4. Result stored in `recording.analysisResult`; status `completed` (or `awaiting_transcript_review` when dual STT disagrees — see F08).
5. Agent stats refreshed after success (not while awaiting transcript review).

## AI outputs

| Output | Used for |
| --- | --- |
| Transcript + diarization | UI, performance model |
| `call_quality` | Call score, agent call quality card; F10 audio-clarity flag is a warning only |
| `participant_performance` | Agent performance score |
| `llm_sentiment` | Sentiment panels (not KPI scores) |
| `ai_extraction` | Summary, tags, **call_outcome** |

## Acceptance criteria

- [x] AC1: POST analyze returns stored result on repeat (reused).
- [x] AC2: Call quality uses clarity + speech rate (50/50).
- [x] AC3: Performance uses seven weighted categories when model succeeds.
- [x] AC4: Rate-limit on performance leaves call quality intact.
- [x] AC5: Call details page shows transcript and audio player.
- [x] AC6: Call details page has **Re-analyze** (POST analyze with `force: true`) to replace transcript and scores.
- [x] AC7: **Remap-only** (`remapOnly: true`) re-runs speaker mapping + LLM on stored utterances (skips STT).
- [x] AC8: **Swap speakers** (`swapSpeakers: true` + `remapOnly`) swaps agent/customer labels; corrections logged in `analysisCorrections`.
- [x] AC9: Swap is not a primary button; shown in review callout when mapping uncertain, otherwise under collapsed **Transcript troubleshooting**, with checkbox confirmation before swap.
- [x] AC10: Dual STT gate (F08): analysis does not complete until transcript is confirmed when engines disagree.
- [x] AC11: Call details can **Clear analysis** (`POST .../clear-analysis`) to remove stored transcript and scores only; call record, audio, and metadata stay visible; Analyze can run again afterward.

## Implementation

| File | Role |
| --- | --- |
| `backend/src/services/analyzeRecording.ts` | Orchestration |
| `backend/src/routes/dbRecordings.ts` | Analyze + clear-analysis APIs |
| `ai-service/app/providers/assemblyai.py` | STT + LLM |
| `ai-service/app/participant_performance.py` | Scoring |
| `frontend/src/views/CallDetailsView.tsx` | UI |

## Open items

- Batch analyze from list (UI supports selected; verify limits in prod).
- Refactor STT → speaker mapping → LLM order per [F07](./F07-assemblyai-transcript-pipeline.md).
