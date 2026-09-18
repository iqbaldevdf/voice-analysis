# POC observations — Phase 2 + Phase 3 speaker validation

Date: 2026-09-16  
Model: SpeechBrain ECAPA-TDNN (`spkrec-ecapa-voxceleb`), CPU, 16 kHz inference copy.

## Phase 2 baseline (prior)

- Profile separation cosine(A,B) typically **0.08–0.32** on Freshcaller mono 8 kHz.
- Long-turn self-consistency strong; short islands often **uncertain** (prefer over false correct).
- Known failure `9002261` island @6.80–8.52s: margin ≈ 0.002 → do not auto-correct.

## Phase 3 POC (robust profiles + island path; utterance JSON only)

| Call | wall_ms | profile sep | A/B status | island corr | boundary corr | uncertain | missed-boundary cand | false auto-corr |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| fc_9002261_5348624 | ~20337 | 0.303 ok | usable/usable | 0 | 0* | 1 | 0 | **0** |
| fc_9050479_5376420 | ~20552 | 0.274 ok | usable/usable | 0 | 0* | 6 | 0 | **0** |
| fc_9051914_5377261 | (see run log) | — | — | 0 | 0* | — | — | **0** |
| fc_9052482_5377562 | (see run log) | — | — | 0 | 0* | — | — | **0** |
| fc_9052995_5377829 | (see run log) | — | — | 0 | 0* | — | — | **0** |

\* Boundary corrections require **word timestamps**. POC utterance sidecars had no words → `boundary_validation_ms=0`. Unit tests cover early/late boundary with synthetic words.

### Known failure call detail (9002261)

- Robust profiles: **both usable**, separation **0.303 (ok)**.
- Island @6.80–8.52s: `validatedSpeaker=B`, margin≈0.005, status=`confirmed` / `acoustic_match_weak_margin` (not corrected).
- **False automatic corrections: 0** (correct behaviour for weak evidence).

### Latency (CPU, includes first-load amortization across calls in one process)

- Profile embedding: ~2–4 s per call (dominant).
- Island validation: ~0.2–0.6 s.
- Long-turn scan (when enabled): adds embedding calls; keep `AUDIO_SV_LONG_TURN_SCAN=false` in production until needed.
- Embedding cache helps repeated identical windows within a call; across different windows miss rate is high (expected).

## Evaluation note

No full gold-labeled 15–30 call set yet. Do **not** change production margins from this POC. Primary success signal so far: **zero false automatic corrections** on sampled real calls while profiles become diagnosable (usable/weak/insufficient + separation).

## Recommended enablement

1. Production default is `AUDIO_SPEAKER_VALIDATION=true`; use emergency `false` only for local debugging without SpeechBrain.
2. When enabling: `AUDIO_SV_BOUNDARY_VALIDATION=true`, `AUDIO_SV_LONG_TURN_SCAN=false`, `AUDIO_SV_LONG_TURN_VALIDATION=false`.
3. Pass words through analyze/finalize so boundary validation can run.
