"""Smoke-test NVIDIA NeMo ECAPA or SpeechBrain ECAPA embeddings.

Usage (from ai-service/):
  set SPEAKER_EMBEDDING_BACKEND=nemo
  C:\\va-ai\\Scripts\\python.exe scripts/smoke_ecapa_backend.py path\\to\\normalized.wav

  set SPEAKER_EMBEDDING_BACKEND=speechbrain
  C:\\va-ai\\Scripts\\python.exe scripts/smoke_ecapa_backend.py path\\to\\normalized.wav
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: smoke_ecapa_backend.py <wav_path>")
        return 2
    wav = Path(sys.argv[1])
    if not wav.is_file():
        print(f"File not found: {wav}")
        return 2

    from app.pipeline.speaker_embeddings import (
        clear_encoder_cache,
        cosine_similarity,
        ecapa_available,
        embedding_backend,
        get_ecapa_encoder,
        load_wav_mono,
        slice_sec,
    )

    backend = embedding_backend()
    print(f"backend={backend} available={ecapa_available()}")
    if not ecapa_available():
        print(
            "Backend not available. For nemo: pip install 'nemo_toolkit[asr]'. "
            "For speechbrain: install torch+speechbrain+checkpoint "
            "(see requirements-speaker-validation.txt)."
        )
        return 1

    clear_encoder_cache()
    t0 = time.perf_counter()
    encoder = get_ecapa_encoder()
    load_ms = (time.perf_counter() - t0) * 1000
    print(f"encoder={encoder.name} load_ms={load_ms:.0f}")

    audio, sr = load_wav_mono(wav)
    print(f"audio={wav.name} sr={sr} duration={len(audio)/sr:.2f}s")

    # Two windows for a quick self-similarity check
    a = slice_sec(audio, sr, 0.5, 2.5)
    b = slice_sec(audio, sr, 2.5, 4.5)
    t1 = time.perf_counter()
    ea = encoder.encode(a, sr)
    eb = encoder.encode(b, sr)
    enc_ms = (time.perf_counter() - t1) * 1000
    sim = cosine_similarity(ea, eb)
    print(f"emb_dim={ea.shape[0]} self_sim(0.5-2.5 vs 2.5-4.5)={sim:.4f} encode_ms={enc_ms:.0f}")
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
