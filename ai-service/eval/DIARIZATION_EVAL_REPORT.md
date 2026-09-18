# Diarization evaluation report

Developer/offline only. Physical speakers A/B — not Agent/Customer.

- Gold file: `C:/Users/MohammedIqbalM/OneDrive - Datafortune Software Solutions Pvt. Ltd/Desktop/Official/voice-analysis/ai-service/eval/gold/templates/9002261_5348624.jsonl`
- Total rows in file: 17
- Labeled rows used: 0
- Unlabeled (skipped): 17
- Calls evaluated: 0
- ECAPA executed: False

## Status: WAITING FOR GOLD LABELS

No rows with `goldSpeaker` set to `A` or `B` were found.
Accuracy / false-correction metrics are **not valid** until manual labels exist.

### What you must do before metrics are valid

1. Open templates under `eval/gold/templates/` (~11 calls / ~184 segments scaffolded).
2. Listen to each audio segment (do not infer from transcript semantics).
3. Set `goldSpeaker` to the true **physical** speaker (`A` or `B`) — not Agent/Customer.
4. Prefer labeling islands, short responses (Okay/Yes/No), interruptions, and stable turns.
5. Append finished segments to `eval/gold/calls.jsonl` (only non-null `goldSpeaker`).
6. Re-run: `python scripts/evaluate_audio_diarization.py --gold eval/gold/calls.jsonl`
7. Optionally: `--threshold-sweep` and `--runtime-smoke`.

Do **not** treat AssemblyAI, ECAPA, or `speaker_mapping.py` as gold.

## Boundary words-path investigation

**Conclusion: not a production wiring bug.** Boundary validation was skipped in Phase 3 POC because utterance-only sidecars had no words.

| Question | Answer |
| --- | --- |
| Are word timestamps available from AssemblyAI? | Yes — `_parse_stt_payload` builds `DiarizedWord` from `raw["words"]` (`assemblyai.py`). |
| Passed into boundary validator in production? | Yes — `analyze()` and `finalize_from_utterances()` both call `_build_analysis_result(..., words=words, audio_path=...)` → `maybe_validate_speakers(..., words=words)`. |
| Dual-STT path? | `run_dual_transcribe` returns `words`; backend `analyzeRecording.ts` sends `words` + `audio_path` to `/finalize-transcript`. |
| Where lost in POC? | `scripts/poc_data/*.utterances.json` store utterances only; `poc_phase3_validation.py` called validator with `words=[]`. |
| Silent skip? | No longer silent — logs `boundary_validation=skipped reason=no_words` when `boundary_validation` is on and words empty. |
| Wiring fix? | Production words path OK. Minimal bugfix: initialize `scores={}` before island loop (`audio_speaker_validation.py`) — prior `similarity_to_a/b` wiring crashed on non-island utterances (`UnboundLocalError`). Regression tests for no_words / words-present boundary path. |

`remapOnly` intentionally sets `skip_audio_speaker_validation=True` and `audio_path=None` — by design.

## Real-runtime verification

- ECAPA executed on any call: **True**

- call `9002261` audio_exists=True ecapa=True status=completed islands=3 island_corr=0 boundaries=16 boundary_corr=0 uncertain=4 aba_present=True
  Short utterances:
  - `Sure.` 89.55-89.95s spk=A status=insufficient_audio reason=short_utterance

This verifies ECAPA ran; it does **not** prove accuracy without gold labels.

### Production flag

`AUDIO_SPEAKER_VALIDATION` defaults to **true** (Stage 3b required on analyze). Set `false` only as an emergency kill switch. Eval harness may still force backends independently.

### Recommended thresholds

**No change.** Without labeled gold, do not tune production thresholds.
Keep current defaults; prioritize zero false corrections when labels arrive.
