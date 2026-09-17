"""Read-only audio clipping for the labeling UI (does not modify source files)."""

from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import soundfile as sf


def audio_duration_ms(path: Path) -> float:
    info = sf.info(str(path))
    return float(info.frames) / float(info.samplerate) * 1000.0


def clip_wav_bytes(
    path: Path,
    *,
    start_ms: int,
    end_ms: int,
    pad_ms: int = 0,
) -> bytes:
    """Return a WAV byte buffer for [start_ms-pad, end_ms+pad], clamped to file bounds."""
    if not path.is_file():
        raise FileNotFoundError(f"Audio not found: {path}")
    if end_ms <= start_ms:
        raise ValueError(f"Invalid range: startMs={start_ms} endMs={end_ms}")

    data, sr = sf.read(str(path), always_2d=True)
    n = data.shape[0]
    duration_ms = n / sr * 1000.0
    a = max(0.0, float(start_ms) - float(pad_ms))
    b = min(duration_ms, float(end_ms) + float(pad_ms))
    if b <= a:
        raise ValueError("Clamped audio window is empty")

    i0 = int(round(a / 1000.0 * sr))
    i1 = int(round(b / 1000.0 * sr))
    i0 = max(0, min(i0, n - 1))
    i1 = max(i0 + 1, min(i1, n))
    clip = data[i0:i1]

    # Downmix to mono for consistent playback.
    if clip.shape[1] > 1:
        clip = np.mean(clip, axis=1, keepdims=True)

    buf = io.BytesIO()
    sf.write(buf, clip, sr, format="WAV", subtype="PCM_16")
    return buf.getvalue()
