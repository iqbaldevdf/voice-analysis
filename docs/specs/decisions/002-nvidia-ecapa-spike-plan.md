# ADR 002 — NVIDIA NeMo ECAPA spike plan (tomorrow)

**Status:** Planned (execute next working day)  
**Date planned:** 2026-09-17  
**Related:** [F07 Stage 3b](../features/F07-assemblyai-transcript-pipeline.md), [NVIDIA NGC ECAPA-TDNN](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn)

## Goal for the day

Decide whether **NVIDIA NeMo ECAPA-TDNN** is worth using as an alternate embedding backend for Stage 3b speaker validation — **not** for transcription.

Success for tomorrow = A/B numbers on our gold/sample calls + a clear **go / no-go / need-more-gold** decision. No production enablement unless metrics clearly win.

## Non-goals (do not do tomorrow)

- Replace AssemblyAI STT / wording quality  
- Replace full diarization with NeMo clustering diarizer (separate later project)  
- Turn on `AUDIO_SPEAKER_VALIDATION=true` in production `.env`  
- Change scoring formulas  

## Context (already true today)

| Item | Current |
| --- | --- |
| Transcription | AssemblyAI |
| Optional Stage 3b embeddings | SpeechBrain ECAPA (`spkrec-ecapa-voxceleb`), CPU |
| Flag | `AUDIO_SPEAKER_VALIDATION` default `false` |
| Eval | `ai-service/eval/gold/` + `evaluate_audio_diarization.py` |

NVIDIA’s [ECAPA TDNN](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn) is the same **family** (speaker embeddings / verification). It outputs ~192-d embeddings from 16 kHz mono WAV — same job as SpeechBrain ECAPA.

## Tomorrow schedule (suggested)

### Morning — Setup (≈1–2 h)

1. Confirm NGC / NeMo install path on the AI machine (`nemo_asr` or NeMo toolkit; GPU optional, CPU OK for spike).  
2. Download / load `ecapa_tdnn` and smoke-test: one WAV → embedding vector + `verify_speakers` on two clips.  
3. Note deps size, license, GPU requirement, load latency.

### Midday — Pluggable encoder spike (≈2–3 h)

1. Add env `SPEAKER_EMBEDDING_BACKEND=speechbrain|nemo` (default `speechbrain`).  
2. Implement `NemoEcapaEncoder` behind the same protocol as `EcapaSpeakerEncoder` in `speaker_embeddings.py` (embed window → L2-normalized vector).  
3. Keep validation logic in `audio_speaker_validation.py` unchanged — only swap embedder.  
4. Unit/smoke: same audio windows → cosine A/B separation for both backends.

### Afternoon — Compare on real calls (≈2–3 h)

1. Run eval harness (or POC script) twice on the **same** call set:
   - Backend A: SpeechBrain  
   - Backend B: NeMo  
2. Record per call: profile separation, island corrections, false corrections (if gold), wall time, failures.  
3. Write short results into `ai-service/eval/NEMO_ECAPA_SPIKE.md` (or append `DIARIZATION_EVAL_REPORT.md`).

### End of day — Decision

| Outcome | Action |
| --- | --- |
| NeMo clearly better separation / fewer false corrections, acceptable latency | Keep backend flag; schedule prod bake with gold; still default off |
| Roughly equal | Keep SpeechBrain; close spike; no NeMo in prod path |
| NeMo worse / install too heavy / unstable on telephony 8 kHz | No-go; document and stop |
| Not enough gold labels | Decision = need more gold first; do not enable either in prod |

## Acceptance checklist (tomorrow)

- [ ] NeMo model loads and embeds one Freshcaller WAV  
- [ ] `SPEAKER_EMBEDDING_BACKEND=nemo` runs Stage 3b path without changing correction rules  
- [ ] Side-by-side metrics vs SpeechBrain on ≥5 calls (ideally gold-labeled)  
- [ ] Written go/no-go note committed under `ai-service/eval/`  
- [ ] Production `.env` still has `AUDIO_SPEAKER_VALIDATION=false`  

## Follow-ups (not tomorrow)

- Full NeMo / Riva diarization replacing AssemblyAI speakers  
- GPU deployment sizing  
- Prod enablement after gold false-correction gate (existing F07 Phase 4 rule)  

## References

- NGC model card: https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn  
- Current encoder: `ai-service/app/pipeline/speaker_embeddings.py`  
- Validation: `ai-service/app/pipeline/audio_speaker_validation.py`  
