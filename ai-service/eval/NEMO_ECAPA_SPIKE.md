# NVIDIA NeMo ECAPA spike results (ADR 002)

**Status:** Code ready — awaiting NeMo install + A/B runs  
**Backend flag:** `SPEAKER_EMBEDDING_BACKEND=nemo`  
**Default remains:** `speechbrain` + `AUDIO_SPEAKER_VALIDATION=true` (emergency off: `false`)

## Setup

```bash
cd ai-service
pip install "nemo_toolkit[asr]"
set SPEAKER_EMBEDDING_BACKEND=nemo
python scripts/smoke_ecapa_backend.py ..\backend\data\normalized\fc_XXXX_YYYY.wav
```

## Smoke

| Item | Result |
| --- | --- |
| Install OK | _pending_ |
| Load ms | _pending_ |
| Embed dim | _pending_ (expect 192) |
| Notes | |

## A/B vs SpeechBrain (≥5 calls)

| Call | SB separation | NeMo separation | SB island corr | NeMo island corr | SB ms | NeMo ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| | | | | | | |

## Decision

- [ ] Go — keep `nemo` as optional backend  
- [ ] No-go — keep SpeechBrain only  
- [ ] Need more gold  

**Rationale:** _fill after runs_
