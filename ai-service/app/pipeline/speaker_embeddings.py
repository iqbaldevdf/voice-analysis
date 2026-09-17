"""Speaker embedding helpers for audio-based diarization validation (CPU).

Uses SpeechBrain ECAPA-TDNN when available. Resamples an inference copy to 16 kHz;
does not restore missing high-frequency content from 8 kHz telephony audio.
"""

from __future__ import annotations

import math
import os
import wave
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import numpy as np


def load_wav_mono(path: str | Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        width = wf.getsampwidth()
        raw = wf.readframes(n)
    if width != 2:
        raise RuntimeError(f"Unsupported sample width {width}; expected 16-bit PCM")
    audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    return audio, sr


def resample_linear(audio: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return audio
    n_out = int(round(len(audio) * sr_out / sr_in))
    if n_out <= 1:
        return audio[:1].copy()
    x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def slice_sec(audio: np.ndarray, sr: int, start: float, end: float) -> np.ndarray:
    a = max(0, int(start * sr))
    b = min(len(audio), int(math.ceil(end * sr)))
    if b <= a:
        return np.zeros(0, dtype=np.float32)
    return audio[a:b]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a.size == 0 or b.size == 0 or a.shape != b.shape:
        return 0.0
    na = float(np.linalg.norm(a))
    nb = float(np.linalg.norm(b))
    if na < 1e-8 or nb < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


class SpeakerEncoder(Protocol):
    name: str

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray: ...


class EcapaSpeakerEncoder:
    """Local SpeechBrain ECAPA-TDNN embeddings (CPU)."""

    name = "speechbrain_ecapa_voxceleb"

    def __init__(self, model_dir: Path) -> None:
        import torch
        from speechbrain.lobes.features import Fbank
        from speechbrain.lobes.models.ECAPA_TDNN import ECAPA_TDNN
        from speechbrain.processing.features import InputNormalization

        self.torch = torch
        self.device = torch.device("cpu")
        self.compute_features = Fbank(n_mels=80)
        self.mean_var_norm = InputNormalization(norm_type="sentence", std_norm=False)
        self.embedding_model = ECAPA_TDNN(
            input_size=80,
            channels=[1024, 1024, 1024, 1024, 3072],
            kernel_sizes=[5, 3, 3, 3, 1],
            dilations=[1, 2, 3, 4, 1],
            attention_channels=128,
            lin_neurons=192,
        )
        ckpt = model_dir / "embedding_model.ckpt"
        if not ckpt.is_file():
            raise FileNotFoundError(
                f"ECAPA checkpoint missing at {ckpt}. "
                "Download speechbrain/spkrec-ecapa-voxceleb embedding_model.ckpt first."
            )
        state = torch.load(str(ckpt), map_location="cpu", weights_only=False)
        if isinstance(state, dict) and "model" in state and isinstance(state["model"], dict):
            state = state["model"]
        self.embedding_model.load_state_dict(state)
        self.embedding_model.eval()
        self.embedding_model.to(self.device)

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray:
        if len(seg) < int(0.25 * sr):
            return np.zeros(192, dtype=np.float32)
        wav = self.torch.from_numpy(seg).float().unsqueeze(0)
        wav_lens = self.torch.ones(1)
        with self.torch.no_grad():
            feats = self.compute_features(wav)
            feats = self.mean_var_norm(feats, wav_lens)
            emb = self.embedding_model(feats)
        v = emb.squeeze().cpu().numpy().astype(np.float32).reshape(-1)
        return v / (np.linalg.norm(v) + 1e-8)


def default_model_dir() -> Path:
    env = (os.getenv("SPEAKER_EMBEDDING_MODEL_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / ".cache" / "speechbrain-ecapa"


@lru_cache(maxsize=1)
def get_ecapa_encoder() -> EcapaSpeakerEncoder:
    return EcapaSpeakerEncoder(default_model_dir())


def ecapa_available() -> bool:
    try:
        import torch  # noqa: F401
        import speechbrain  # noqa: F401
    except ImportError:
        return False
    return (default_model_dir() / "embedding_model.ckpt").is_file()
