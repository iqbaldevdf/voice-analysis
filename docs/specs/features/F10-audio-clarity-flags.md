# F10 — Audio clarity flags

**Status:** Implemented  
**Owner:** AI service + backend + frontend  
**Related:** [F02](./F02-call-analysis.md), [F05](./F05-recordings-list.md), [F07 AssemblyAI pipeline](./F07-assemblyai-transcript-pipeline.md), [F08](./F08-dual-stt-transcript-review.md)

## User story

As a reviewer, I want an explicit **OK / Caution / Poor** flag when a recording is noisy or low-confidence so I can treat the transcript as unreliable without skipping analysis.

## Rules

1. Always **run analysis** (STT + LLM + scoring). Poor audio must not 422 or skip scoring.
2. Flag is a **reliability warning**, not a change to call-quality or agent-performance formulas (`Call-and-Agent-Performance.md` unchanged).
3. Inputs: AssemblyAI **word confidence per speaker** plus acoustic checks on each speaker’s talk windows (clipping, RMS). Call-level silence ratio can still add `high_silence`.
4. Dual STT disagreement (F08) stays optional and **off by default**; it is not required for this flag.
5. Do not invent transcript words; mark uncertain regions instead.
6. Yellow low-confidence word highlights stay. When agent or customer audio is Caution/Poor, the **Transcript** panel shows a tag: “Audio quality was not good — transcription may mismatch”, plus per-speaker chips.

## Flag logic (v1, env-tunable)

| Flag | When |
| --- | --- |
| **Poor** | Mean word confidence &lt; 0.50 **or** ≥30% of words with confidence &lt; 0.40 **or** strong clipping / near-silence / very high silence |
| **Caution** | Mean 0.50–0.70 **or** 15–30% low-confidence words **or** mild clipping / very low RMS / high silence |
| **OK** | Otherwise |

Applied **per speaker** (agent and customer) on that speaker’s words and WAV windows. Call-level flag is the worse of the two. Whole-file RMS is not used for `too_quiet` (pauses between speakers would false-flag a mixed call).

Reason codes: `low_asr_confidence`, `many_uncertain_words`, `clipping`, `too_quiet`, `high_silence`.

Env knobs (AI service): `AUDIO_CLARITY_MEAN_POOR`, `AUDIO_CLARITY_MEAN_CAUTION`, `AUDIO_CLARITY_LOW_WORD`, `AUDIO_CLARITY_LOW_PCT_POOR`, `AUDIO_CLARITY_LOW_PCT_CAUTION`, `AUDIO_CLARITY_CLIP_POOR`, `AUDIO_CLARITY_CLIP_CAUTION`, `AUDIO_CLARITY_RMS_POOR`, `AUDIO_CLARITY_RMS_CAUTION`, `AUDIO_CLARITY_SILENCE_POOR`, `AUDIO_CLARITY_SILENCE_CAUTION`.

## Acceptance criteria

- [x] AC1: Analyze still completes when the flag is `caution` or `poor`.
- [x] AC2: `call_quality.audio_clarity_flag` is `ok` \| `caution` \| `poor` with `audio_clarity_reasons`.
- [x] AC3: Payload includes `avg_asr_confidence`, `low_confidence_word_pct`, and up to 50 `low_confidence_spans`.
- [x] AC4: Call Details **Transcript** panel shows a tag when Caution/Poor: audio quality was not good, transcription may mismatch.
- [x] AC5: Transcript highlights low-confidence words without loud error styling.
- [x] AC6: Recordings list shows an **Unclear audio** badge when flag is `caution` or `poor`.
- [x] AC7: Scoring formulas are unchanged; `clarity_score` / overall call quality math is not rewritten for this flag.
- [x] AC8: Unit tests cover threshold combinations, clipped vs clean WAV fixtures, and independent agent/customer flags.
- [x] AC9: `speaker_audio_clarity[]` reports flag, reasons, and mean confidence for agent and customer.

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| POST | AI `/analyze` | `call_quality` includes audio-clarity fields |
| GET | `/recordings/db/listings` | `audioClarityFlag` on list items (no full analysis blob) |
| GET | `/recordings/db/:callId` | Full `analysisResult.call_quality` including spans |
| GET | `/agents/:agentId` | Recording rows include `audioClarityFlag` |

## UI touchpoints

| Route | Change |
| --- | --- |
| `/recordings` | Badge **Unclear audio** for caution/poor |
| `/recordings/:callId/:recordingId` | Transcript tag + per-speaker chips + in-transcript highlights |
| `/agents/:agentId` | Same list badge on analyzed rows |

## Data model

| Collection / path | Field | Change |
| --- | --- | --- |
| `recordings.analysisResult.call_quality` | `audio_clarity_flag`, `audio_clarity_reasons`, `avg_asr_confidence`, `low_confidence_word_pct`, `low_confidence_spans`, `speaker_audio_clarity[]` | New |
| `recording_listings` | `audioClarityFlag` | Projection for list badge |

## Implementation notes

| File | Role |
| --- | --- |
| `ai-service/app/pipeline/audio_clarity.py` | Flag + acoustics |
| `ai-service/app/analytics.py` | Attach fields on `CallQuality` |
| `ai-service/app/schemas.py` | Types |
| `frontend/src/views/CallDetailsView.tsx` | Banner + highlights |
| `frontend/src/views/CallsListView.tsx` | List badge |

## Open items

- Neural MOS / PESQ not in v1.
- Do not auto-exclude poor calls from F03 quarter KPIs unless product asks later.

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-18 | Initial implementation |
| 2026-09-18 | Per-speaker flags; transcript-section mismatch tag |
