# F07 — AssemblyAI transcript pipeline (speaker-aware)

**Status:** Partial  
**Owner:** AI service (+ backend context pass-through)  
**Related:** [F01](./F01-freshcaller-sync.md), [F02](./F02-call-analysis.md), [02-architecture.md](../02-architecture.md), [03-data-model.md](../03-data-model.md)

## User story

As a reviewer, I want transcripts where **agent** and **customer** are correctly identified before any LLM scoring, so sentiment, performance, introduction-script, and coaching notes reflect the right speaker.

## Background

Today analysis is implemented as one method in `ai-service/app/providers/assemblyai.py`. The desired pipeline is explicit stages:

```
Freshcaller metadata
        ↓
   FFmpeg normalize (mono; typically 16 kHz for STT)
        ↓
   AssemblyAI STT + diarization
        ↓
   utterances[]  (+ words[])
        ↓
   word/temporal diarization heuristics (suspicious islands)
        ↓
   AUDIO-BASED SPEAKER VALIDATION (required on analyze; ECAPA embeddings)
        ↓
   validated A/B transcript (originalSpeaker preserved)
        ↓
   speaker mapping  (A/B → agent | customer)
        ↓
   LLM Gateway  (sentiment, extraction, performance)
        ↓
   analytics + scoring modules
```

**Important:** Audio validation answers *which physical voice* spoke a region. It does **not** assign Agent/Customer roles. End users are never asked to verify speaker labels or confidence scores.
This spec defines **target behaviour** and a phased implementation plan. No code change until status moves to **Approved**.

---

## Current state (AS-IS)

| Stage | What happens today | Gap |
| --- | --- | --- |
| Freshcaller | `participant_context` passed from backend (`direction`, `callNotes`, `participants[]`) | **Not used** for speaker mapping in `analyze()` |
| AssemblyAI STT | Upload → `/v2/transcript` with `speaker_labels` → poll → `utterances`, `words` | OK |
| utterances[] | Parsed to `DiarizedUtterance` (speaker = `A`, `B`, …) | OK |
| Speaker mapping | **Talk-time heuristic**: most talk = agent | Wrong on inbound calls, short agent intros, or when customer dominates |
| LLM Gateway | Runs **before** analytics refines roles; prompts use `A`/`B` labels | Sentiment + extraction can mis-attribute agent/customer |
| Downstream | `build_call_analytics`, `participant_performance`, `introduction_script` use `role_hints` | All depend on mapping quality |

**Order today** (simplified):

```
utterances → talk-time role_hints → LLM sentiment → analytics role_guess → LLM extraction → performance LLM
```

**Order target**:

```
utterances → speaker mapping (stable) → speaker-aware transcript → LLM Gateway → analytics
```

---

## Target pipeline (TO-BE)

### Stage 1 — Freshcaller context (input)

**Source:** `recording` document + `participant_context` on `POST /analyze`.

| Field | Use in mapping |
| --- | --- |
| `agentName` | Label agent turns in UI transcript; tie-break for mapping |
| `participants[]` with `role` + `name` | Expected roles; optional name mention detection |
| `direction` | `outgoing` → agent often speaks first; `incoming` → customer may answer first |
| `callNotes` | Voicemail/forwarded hints (already used elsewhere in F06) |

**Rule:** Freshcaller metadata is **hints**, not ground truth. Final mapping must be justified from audio/transcript evidence.

### Stage 2 — AssemblyAI transcription

Unchanged API contract:

- Upload normalized 16 kHz mono WAV
- `POST /v2/transcript` with `speaker_labels: true`, `speech_models: [universal-2]`
- Optional `speakers_expected: 2` for telephony
- Output: `transcript_id`, `utterances[]`, `words[]`, `audio_duration`, `language_code`

**Rule:** STT stage produces **diarization labels only** (`A`, `B`, …). No agent/customer names at this stage.

### Stage 3 — utterances[] (canonical diarized structure)

Normalized in-memory (and optionally persisted) structure:

```json
{
  "speaker": "A",
  "start": 1.2,
  "end": 4.5,
  "text": "Hello, this is Surbhi from Datafortune.",
  "confidence": 0.91
}
```

**Rules:**

- Timestamps in **seconds** (float), converted from AssemblyAI ms
- Preserve original diarization speaker id (`speaker_raw`) if labels are rewritten later
- Empty utterances dropped

### Stage 3b — Audio-based speaker validation (required on analyze)

**Flag:** `AUDIO_SPEAKER_VALIDATION` (default `true`). Set `false` only for emergency debugging.

**Module:** `ai-service/app/pipeline/audio_speaker_validation.py`  
**Embeddings:** SpeechBrain ECAPA-TDNN (`speechbrain/spkrec-ecapa-voxceleb`) by default, or NVIDIA NeMo ECAPA (`ecapa_tdnn`) when `SPEAKER_EMBEDDING_BACKEND=nemo` (ADR 002). CPU; install via `requirements-speaker-validation.txt`.

**Rule:** Normal `POST /analyze` and dual-STT finalize **must** run Stage 3b when the flag is on. If ECAPA deps/checkpoint are missing, analyze **fails** with a clear error (not a silent skip). `remapOnly` / `swapSpeakers` still skip acoustic validation.

**Behaviour (Phase 2 + Phase 3):**

1. Detect suspicious A/B islands (`A…B…A` / `B…A…B`) with duration ≤ `AUDIO_SV_ISLAND_MAX_SEC`.
2. Build **robust** A/B profiles from non-island turns ≥ `AUDIO_SV_MIN_PROFILE_SEC`: leave-one-out outlier rejection, duration-weighted centroid, profile quality (`usable` / `weak` / `insufficient`).
3. Measure cross-speaker profile separation (cosine). If too similar (`AUDIO_SV_WEAK_SEPARATION_COSINE`) or profiles not both `usable`, **disable auto-correction** for that call.
4. Score islands via cosine similarity (not probability); sources: `audio_embedding_island`.
5. Optional **boundary validation** (`AUDIO_SV_BOUNDARY_VALIDATION`, default on when master flag on): word-level early/late boundary shifts only with strong margin; source `audio_embedding_boundary`. Requires word timestamps. Production `analyze` / dual-STT `finalize` pass AssemblyAI words; utterance-only POC sidecars do not (boundary skips with `reason=no_words`).
6. Optional **long-turn scan** (`AUDIO_SV_LONG_TURN_SCAN`, default off): flag missed-boundary candidates; auto-correct remains off unless `AUDIO_SV_LONG_TURN_VALIDATION=true` (still conservative).
7. Embedding cache reuses identical `(startMs,endMs)` windows within a call.
8. Outcomes: `confirmed` | `corrected` | `uncertain` | `insufficient_audio` (prefer uncertain over wrong correction).
9. Preserve AssemblyAI label as `speaker_raw` / `speaker_validation.original_speaker`.
10. Resample an inference **copy** to 16 kHz when needed; original recording unchanged.
11. `remapOnly` / `swapSpeakers` **must not** re-run acoustic validation.

**Phase 4 evaluation (offline, not product UX):** Gold labels are physical `A`/`B` only (not Agent/Customer). Dataset: `ai-service/eval/gold/`. Labeling UI: `scripts/gold_label_server.py` (local). Harness: `scripts/evaluate_audio_diarization.py` → `eval/DIARIZATION_EVAL_REPORT.md`. Metrics guide threshold tuning and backend comparison; Stage 3b remains on by default regardless of eval progress.

**Phase 5 (pluggable backend):** `SPEAKER_EMBEDDING_BACKEND=speechbrain|nemo` selects the Stage 3b encoder (`speaker_embeddings.py`). NVIDIA NeMo ECAPA spike plan: [ADR 002](../decisions/002-nvidia-ecapa-spike-plan.md). Smoke: `scripts/smoke_ecapa_backend.py`. Production default: `AUDIO_SPEAKER_VALIDATION=true` (SpeechBrain); set `false` only as an emergency kill switch.

**Recording-level audit:** `analysisResult.speaker_validation` including `profile_status`, `profile_quality`, `profile_separation`, `islands_checked`, `boundaries_checked`, `boundary_corrections`, `missed_boundary_candidates`, `timing_ms`, cache hits/misses.
### Stage 4 — Speaker mapping

Dedicated step: `map_speakers(utterances, freshcaller_context) → SpeakerMapping`

```json
{
  "mapping": { "A": "agent", "B": "customer" },
  "confidence": 0.85,
  "method": "weighted_signals",
  "signals": [
    { "signal": "talk_time", "winner": "A", "weight": 0.2 },
    { "signal": "direction_outgoing_opener", "winner": "A", "weight": 0.3 },
    { "signal": "name_mention", "winner": "A", "phrase": "Surbhi", "weight": 0.25 }
  ],
  "agent_speaker": "A",
  "customer_speaker": "B"
}
```

**Mapping strategies** (combine with scores; highest wins):

| Signal | Logic |
| --- | --- |
| Talk-time | More talk time → likely agent (weak alone) |
| Direction | Outgoing: first substantive speaker often agent; incoming: first answer often customer |
| Name match | Agent name / company name in early turns |
| Scripted opener | Datafortune intro phrases (reuse F07 / intro theme phrases) |
| Calling from company | "calling you from …" → agent |
| Greets customer by name | "Hi Jaydon, …" → agent (fuzzy first-name match) |
| Call screening | Automated "record your name / reason for calling" prompts excluded from heuristics |
| LLM confirmation | Optional small Gateway call **only** for mapping when confidence &lt; threshold |

**Rules:**

1. Exactly **one** agent and **one** customer when 2 speakers detected
2. 3+ speakers: map top talkers; mark extras as `unknown` or `ivr`
3. If confidence &lt; `SPEAKER_MAP_MIN_CONFIDENCE` (default 0.6), set `mapping_uncertain: true` and surface note in UI
4. Mapping runs **once**; all downstream steps consume the same `SpeakerMapping`

### Stage 5 — Speaker-aware transcript

Build human-readable and LLM-ready transcript **after** mapping:

```
[agent] Surbhi (0.0–6.2s): Hi, I'm calling from Datafortune…
[customer] Chris (6.2–11.0s): Hello, yes I'm here.
```

Two outputs:

| Artifact | Consumer |
| --- | --- |
| `transcript_display[]` | Frontend transcript panel (role + optional name) |
| `transcript_llm` | Numbered string for Gateway prompts |

**Rules:**

- UI may show masked agent name per product policy
- LLM prompts use **role labels** (`agent` / `customer`), not `A` / `B`
- Include `transcript_id` on Gateway calls when available (AssemblyAI context)

### Stage 6 — LLM Gateway (post-mapping only)

All Gateway calls run **after** stages 4–5:

| Call | Input | Output |
| --- | --- | --- |
| Sentiment | `transcript_llm` + `transcript_id` | `llm_sentiment`, per-utterance sentiment |
| Extraction | `transcript_llm` + roles | `ai_extraction` (summary, tags, call_outcome) |
| Performance | utterances + `role_hints` from mapping | `participant_performance` |

**Rules:**

1. No Gateway call uses unmapped `A`/`B` labels in prompts (except optional mapping-only prompt)
2. Rate-limit retries unchanged (429 backoff)
3. Partial failure: STT + mapping still stored; LLM sections marked `available: false`

### Stage 7 — Analytics & scoring (unchanged inputs, better roles)

Existing modules, fed mapped roles:

- `build_call_analytics` → `speaker_metrics`, `call_quality` (F10 audio-clarity flag attached here)
- `score_introduction_script` → agent opening themes
- `run_participant_performance` → seven-category agent score

---

## Proposed module layout

| Module | Responsibility |
| --- | --- |
| `ai-service/app/pipeline/stt_assemblyai.py` | Upload, create transcript, poll, parse utterances |
| `ai-service/app/pipeline/speaker_mapping.py` | `map_speakers()`, confidence, signals |
| `ai-service/app/pipeline/transcript_builder.py` | `build_speaker_aware_transcript()` |
| `ai-service/app/pipeline/llm_gateway.py` | Shared `llm_gateway_chat`, sentiment, extraction |
| `ai-service/app/providers/assemblyai.py` | Thin orchestrator calling pipeline stages |

Backend changes are minimal: ensure `participant_context` always includes `agentName`, `participants`, `direction`.

---

## Data model changes

Add to `recording.analysisResult` (summary; full shape in `03-data-model.md` when approved):

| Field | Type | Notes |
| --- | --- | --- |
| `speaker_mapping` | object | `mapping`, `confidence`, `method`, `signals` |
| `speaker_validation` | object | Audio validator summary (F07 Stage 3b) |
| `transcript_display` | array | Optional enriched utterances for UI |
| `speaker_raw` on utterances/words | string | Original AAI label if rewritten |
| `speaker_validation` on utterances/words | object | Per-region audit (`original_speaker`, `validated_speaker`, status, similarity score) |

**Re-map without re-STT:** New endpoint `POST /remap-speakers` (optional phase) re-runs stages 4–7 on stored utterances.

---

## Acceptance criteria

- [x] AC1: Pipeline stages are separate functions; `analyze()` orchestrates in documented order.
- [x] AC2: `participant_context` from Freshcaller influences speaker mapping (direction + agent name at minimum).
- [x] AC3: LLM Gateway prompts use `agent` / `customer`, not raw diarization ids.
- [x] AC4: `speaker_mapping` persisted in `analysisResult` with confidence and method.
- [x] AC5: Call detail transcript shows role-aware labels (Agent / Customer or names).
- [x] AC6: Introduction script and performance use mapped agent speaker, not talk-time-only guess.
- [x] AC7: Low-confidence mapping shows a visible note on call detail (no silent wrong attribution).
- [x] AC8: Re-analyze existing calls produces new mapping fields; STT can be skipped when `transcript_id` + utterances cached (`POST /remap-speakers`, `remapOnly` on analyze).
- [x] AC9: Audio speaker validation runs after AssemblyAI diarization and before `map_speakers` on normal analyze when `AUDIO_SPEAKER_VALIDATION=true` (default); missing ECAPA fails analyze.
- [x] AC10: Original AssemblyAI speaker labels are preserved for audit (`speaker_raw` / `original_speaker`); corrections use similarity scores, not claimed probabilities.
- [x] AC11: `remapOnly` / `swapSpeakers` do not re-run acoustic validation.
- [x] AC12: End users are not prompted to verify speaker labels or confidence scores; validation is automatic when enabled.
- [x] AC13: Robust profiles reject within-speaker acoustic outliers; auto-correct requires usable A/B profiles and adequate separation.
- [x] AC14: Boundary validation can reassign words near A↔B transitions only with strong acoustic margin; word timestamps unchanged except speaker label.
- [x] AC15: Long-turn missed-boundary scan is independently flaggable and does not auto-correct by default.
- [x] AC16: Offline Phase 4 gold format + eval harness exist (`eval/gold/`, `scripts/evaluate_audio_diarization.py`); harness may force backends independently of the production default-on flag.
---

## Implementation phases

### Phase 0 — Spec approval (this document)

- Review mapping signals with ops/sales
- Confirm UI: show `A`/`B` fallback vs always role labels
- Approve confidence threshold and uncertain-mapping UX

### Phase 1 — Refactor only (no behaviour change)

- Extract pipeline modules from `assemblyai.py`
- Unit tests with fixture utterances + Freshcaller context
- Status: behaviour identical to today

### Phase 2 — Speaker mapping v1

- Implement `speaker_mapping.py` with weighted signals
- Wire Freshcaller `direction`, `agentName`, `participants`
- Persist `speaker_mapping` in result
- **Reorder:** mapping before any LLM call

### Phase 3 — Speaker-aware transcript

- `transcript_builder.py` for display + LLM strings
- Update `CallDetailsView` transcript to use roles (and names when known)

### Phase 4 — LLM prompt migration

- Update sentiment, extraction, performance prompts to mapped roles
- Pass `transcript_id` consistently
- Verify rate limits under sequential analyze

### Phase 5 — Backfill & ops

- Script: re-analyze or remap batch for historical calls
- Document in F02 open items; update `02-architecture.md` diagram

---

## API touchpoints

| Method | Path | Change |
| --- | --- | --- |
| POST | `/analyze` | Response includes `speaker_mapping`, optional `transcript_display` |
| POST | `/remap-speakers` | Re-run mapping + LLM on stored utterances; optional `speaker_override` |
| GET | `/health` | Report pipeline version / mapping module enabled |

Backend `POST` analyze flow unchanged; only richer `participant_context` if needed.

---

## UI touchpoints

| Route | Change |
| --- | --- |
| `/recordings/:callId/:recordingId` | Transcript bubbles labeled Agent/Customer; mapping confidence note |
| `/agents/:agentId` | No change unless mapping affects quarter aggregates |

---

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Wrong mapping worse than today | Confidence gate + manual override (future) |
| Extra LLM call for mapping | Only when confidence &lt; threshold |
| Re-analyze cost | Optional remap endpoint skips STT |
| 3+ speakers on conference calls | Mark uncertain; do not force binary map |

---

## Open questions (for discussion)

1. **Ground truth:** Should reviewers manually swap agent/customer when mapping is wrong? (UI toggle — separate spec?)
2. **LLM mapping:** Use Gateway for every call or only low-confidence?
3. **Speaker names in transcript:** Show Freshcaller names vs generic “Agent” / “Customer”?
4. **Cached STT:** Store `transcript_id` + raw utterances in Mongo to avoid re-upload on re-analyze?
5. **Introduction script:** Require mapped agent before scoring (strict) vs current talk-time fallback?

---

## Implementation notes (current files)

| File | Role today | Change |
| --- | --- | --- |
| `ai-service/app/providers/assemblyai.py` | Monolithic analyze | Orchestrator |
| `ai-service/app/analytics.py` | Role guess by talk time | Consume `SpeakerMapping` |
| `ai-service/app/introduction_script.py` | Uses `role_hints` | Same, better input |
| `ai-service/app/participant_performance.py` | LLM performance | Prompt uses mapped roles |
| `backend/src/services/analyzeRecording.ts` | Passes `participant_context` | Add `agentName` if missing |
| `frontend/src/views/CallDetailsView.tsx` | Shows `A`/`B` speakers | Role-aware labels |

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-09 | Initial draft — pipeline plan for discussion |
| 2026-09-10 | Phase 2–3 implemented: speaker_mapping, transcript_builder, LLM role prompts, UI note |
