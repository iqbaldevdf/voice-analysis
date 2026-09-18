# ADR 002 — NVIDIA NeMo ECAPA spike plan

**Status:** Ready to execute  
**Branch context:** `feature/bot-handling-clear-analysis-ecapa-eval`  
**Related:** [F07 Stage 3b](../features/F07-assemblyai-transcript-pipeline.md), [NVIDIA NGC ECAPA-TDNN](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn)

## Goal

Decide whether **NVIDIA NeMo ECAPA-TDNN** is worth using as an alternate embedding backend for Stage 3b speaker validation — **not** for transcription.

Success = A/B numbers on our gold/sample calls + a clear **go / no-go / need-more-gold** decision. No production enablement unless metrics clearly win.

## How it fits VoiceIQ

```
Freshcaller mono 8 kHz WAV
  → ffmpeg normalize → 16 kHz mono
  → AssemblyAI = words + A/B diarization
  → Stage 3b (required on analyze) = ECAPA embeddings check islands/boundaries
  → map_speakers = Agent / Customer / Bot
```

| Piece | Role |
| --- | --- |
| AssemblyAI | Speech-to-text + initial speakers |
| SpeechBrain ECAPA (default) | Required Stage 3b embeddings |
| [NVIDIA NeMo ECAPA](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn) | Same job: 192-d speaker embedding from 16 kHz mono |

Input requirement from NGC: **16 kHz mono WAV** (matches our normalized files).

## Non-goals

- Replace AssemblyAI STT / wording quality  
- Replace full diarization with NeMo clustering diarizer (later project)  
- Change scoring formulas  
- Force NeMo as the production default (SpeechBrain remains default)  

## Context (already true today)

| Item | Current |
| --- | --- |
| Transcription | AssemblyAI |
| Optional Stage 3b embeddings | SpeechBrain ECAPA (`spkrec-ecapa-voxceleb`), CPU; NeMo via env |
| Flag | `AUDIO_SPEAKER_VALIDATION` default `true` (emergency off: `false`) |
| Eval | `ai-service/eval/gold/` + `scripts/evaluate_audio_diarization.py` |
| Encoder code | `ai-service/app/pipeline/speaker_embeddings.py` |

## Execution plan (one day)

### Step 1 — Setup (≈1–2 h)

1. Use AI venv: `C:\va-ai\Scripts\python.exe` (or a dedicated spike venv if NeMo is heavy).  
2. Install NeMo ASR speaker stack (CPU OK for spike; GPU optional):

```bash
pip install "nemo_toolkit[asr]"
# or follow current NeMo install docs for your Python version / OS
```

3. Smoke-test from the [NGC model card](https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn):

```python
import nemo.collections.asr as nemo_asr
speaker_model = nemo_asr.models.EncDecSpeakerLabelModel.from_pretrained(model_name="ecapa_tdnn")
embs = speaker_model.get_embedding(r"path\to\normalized\fc_CALL_REC.wav")
print(embs.shape)  # expect ~192-d
# optional: speaker_model.verify_speakers(clip_a.wav, clip_b.wav)
```

4. Note: install size, Windows issues, first-load latency, GPU vs CPU.

### Step 2 — Pluggable encoder (≈2–3 h)

1. Add env `SPEAKER_EMBEDDING_BACKEND=speechbrain|nemo` (default `speechbrain`).  
2. Implement `NemoEcapaEncoder` in `speaker_embeddings.py` behind the same protocol as SpeechBrain (`embed` window → L2-normalized vector).  
3. Do **not** change correction rules in `audio_speaker_validation.py` — only swap embedder.  
4. Smoke: same windows → cosine A/B separation for both backends.

### Step 3 — Compare on real calls (≈2–3 h)

1. Pick ≥5 Freshcaller calls (gold-labeled preferred from `ai-service/eval/gold/`).  
2. Run Stage 3b / eval harness twice:
   - `SPEAKER_EMBEDDING_BACKEND=speechbrain`
   - `SPEAKER_EMBEDDING_BACKEND=nemo`
3. Record per call: profile separation, island corrections, false corrections (if gold), wall ms, failures.  
4. Write `ai-service/eval/NEMO_ECAPA_SPIKE.md`.

### Step 4 — Decision

| Outcome | Action |
| --- | --- |
| NeMo clearly better separation / fewer false corrections, OK latency | Keep backend flag; consider switching default backend after more gold |
| Roughly equal | Keep SpeechBrain; close spike |
| NeMo worse / install too heavy / bad on 8 kHz telephony | No-go; document and stop |
| Not enough gold | Need more gold first; keep SpeechBrain as Stage 3b default |

## Acceptance checklist

- [x] Code: `SPEAKER_EMBEDDING_BACKEND=nemo` + `NemoEcapaEncoder` in `speaker_embeddings.py`
- [x] Smoke script: `scripts/smoke_ecapa_backend.py`
- [x] Health exposes `speaker_embedding_backend`
- [ ] NeMo model loads and embeds one Freshcaller normalized WAV (run smoke after `pip install "nemo_toolkit[asr]"`)
- [ ] Side-by-side metrics vs SpeechBrain on ≥5 calls
- [ ] Written go/no-go in `ai-service/eval/NEMO_ECAPA_SPIKE.md`
- [x] Production default: `AUDIO_SPEAKER_VALIDATION=true` / backend `speechbrain` (NeMo remains opt-in via env)

## Follow-ups (later)

- Full NeMo / Riva diarization replacing AssemblyAI speakers  
- GPU sizing for prod  
- Backend switch SpeechBrain → NeMo only after gold false-correction comparison (F07 Phase 4)  

## References

- NGC: https://catalog.ngc.nvidia.com/orgs/nvidia/nemo/models/ecapa_tdnn  
- Current encoder: `ai-service/app/pipeline/speaker_embeddings.py`  
- Validation: `ai-service/app/pipeline/audio_speaker_validation.py`  
- Required deps: `ai-service/requirements-speaker-validation.txt`  
