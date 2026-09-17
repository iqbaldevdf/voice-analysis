# F08 — Dual STT + transcript confirmation gate

**Status:** Implemented  
**Owner:** AI service + backend + frontend  
**Related:** [F02](./F02-call-analysis.md), [F07 AssemblyAI pipeline](./F07-assemblyai-transcript-pipeline.md)

## User story

As a reviewer, I want transcription validated by two engines when they disagree so I can confirm the correct text before sentiment and scores run.

## Rules

1. Pass A: AssemblyAI (`universal-2`, diarization). Pass B: local faster-whisper on the same 16 kHz mono WAV.
2. Auto-accept when WER/similarity thresholds pass and no critical token mismatches (negations, numbers).
3. If not auto-accepted, `analysisStatus` = `awaiting_transcript_review`; no LLM scoring until user confirms.
4. Confirm runs `finalize-transcript` only (no re-STT unless user forces full re-analyze).
5. Original Freshcaller audio is never overwritten.
6. Dual pass is **off by default** (`DUAL_STT_ENABLED=false`): analyze uses **AssemblyAI only**. Set `DUAL_STT_ENABLED=true` to re-enable Whisper compare + review gate.

## Acceptance criteria

- [x] AC1: `POST /transcribe-dual` returns both passes + compare result.
- [x] AC2: Analyze orchestration auto-completes when engines agree.
- [x] AC3: Disagreement sets `awaiting_transcript_review` and stores `transcript_review` in `analysisResult`.
- [x] AC4: `POST .../confirm-transcript` with `chosenSource` completes analysis.
- [x] AC5: Call detail UI shows review banner, metrics, and pick AssemblyAI / Whisper.
- [x] AC6: Recordings list shows review state.

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| POST | AI `/transcribe-dual` | Dual STT + compare |
| POST | AI `/finalize-transcript` | Mapping + LLM on fixed utterances |
| POST | `/api/db/recordings/:callId/:recordingId/confirm-transcript` | User confirmation |

## Data model

| Field | Notes |
| --- | --- |
| `analysisStatus` | `transcribing`, `awaiting_transcript_review` added |
| `analysisResult.transcript_review` | Passes, WER, similarity, status |

## Agent list UX

When analyze stops at `awaiting_transcript_review`, the agent table shows **Review transcript** (not “Needs analysis”) and **Review** opens call details to confirm AssemblyAI vs Whisper. Re-posting analyze without `force` returns `reused: true` and does not re-run dual STT.

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-14 | Initial implementation |
| 2026-09-15 | Agent/calls list: review badge, skip batch re-analyze for awaiting rows |
| 2026-09-16 | Default `DUAL_STT_ENABLED=false` — AssemblyAI-only STT for analyze; Whisper optional |
