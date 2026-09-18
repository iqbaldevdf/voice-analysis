"""Speaker embedding helpers for audio-based diarization validation (CPU).

Backends (env SPEAKER_EMBEDDING_BACKEND):
  - speechbrain (default): SpeechBrain ECAPA-TDNN (spkrec-ecapa-voxceleb)
  - nemo: NVIDIA NeMo ECAPA-TDNN (NGC ecapa_tdnn)

Resamples an inference copy to 16 kHz; does not restore missing HF from 8 kHz telephony.
"""

from __future__ import annotations

import math
import os
import tempfile
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


def _l2_normalize(v: np.ndarray) -> np.ndarray:
    out = v.astype(np.float32).reshape(-1)
    return out / (np.linalg.norm(out) + 1e-8)


def write_wav_mono_16bit(path: str | Path, audio: np.ndarray, sr: int) -> None:
    clipped = np.clip(audio, -1.0, 1.0)
    pcm = (clipped * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(pcm.tobytes())


class SpeakerEncoder(Protocol):
    name: str

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray: ...


def embedding_backend() -> str:
    raw = (os.getenv("SPEAKER_EMBEDDING_BACKEND") or "speechbrain").strip().lower()
    if raw in {"nemo", "nvidia", "nemo_ecapa", "ngc"}:
        return "nemo"
    return "speechbrain"


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
        return _l2_normalize(emb.squeeze().cpu().numpy())


class NemoEcapaEncoder:
    """NVIDIA NeMo ECAPA-TDNN embeddings (NGC ecapa_tdnn). Expects 16 kHz mono."""

    name = "nemo_ecapa_tdnn"
    target_sr = 16000

    def __init__(self) -> None:
        import nemo.collections.asr as nemo_asr

        model_name = (os.getenv("NEMO_ECAPA_MODEL") or "ecapa_tdnn").strip() or "ecapa_tdnn"
        self.model = nemo_asr.models.EncDecSpeakerLabelModel.from_pretrained(model_name=model_name)
        self.model.eval()
        # Prefer CPU for VoiceIQ hosts unless CUDA is explicitly available and requested.
        prefer_gpu = (os.getenv("NEMO_ECAPA_DEVICE") or "cpu").strip().lower() == "cuda"
        try:
            import torch

            if prefer_gpu and torch.cuda.is_available():
                self.model = self.model.cuda()
            else:
                self.model = self.model.cpu()
        except Exception:
            pass

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray:
        if len(seg) < int(0.25 * sr):
            return np.zeros(192, dtype=np.float32)
        audio = resample_linear(seg, sr, self.target_sr)
        # NeMo get_embedding is path-based across versions; use a short temp WAV.
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            write_wav_mono_16bit(tmp_path, audio, self.target_sr)
            emb = self.model.get_embedding(tmp_path)
            if hasattr(emb, "detach"):
                emb = emb.detach().cpu().numpy()
            return _l2_normalize(np.asarray(emb, dtype=np.float32))
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def default_model_dir() -> Path:
    env = (os.getenv("SPEAKER_EMBEDDING_MODEL_DIR") or "").strip()
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[2] / ".cache" / "speechbrain-ecapa"


def speechbrain_available() -> bool:
    try:
        import torch  # noqa: F401
        import speechbrain  # noqa: F401
    except ImportError:
        return False
    return (default_model_dir() / "embedding_model.ckpt").is_file()


def nemo_available() -> bool:
    try:
        import nemo.collections.asr  # noqa: F401
    except ImportError:
        return False
    return True


def ecapa_available() -> bool:
    """True when the configured SPEAKER_EMBEDDING_BACKEND can run."""
    if embedding_backend() == "nemo":
        return nemo_available()
    return speechbrain_available()


@lru_cache(maxsize=2)
def _encoder_for(backend: str) -> SpeakerEncoder:
    if backend == "nemo":
        return NemoEcapaEncoder()
    return EcapaSpeakerEncoder(default_model_dir())


def get_ecapa_encoder() -> SpeakerEncoder:
    """Return the encoder for SPEAKER_EMBEDDING_BACKEND (cached per backend name)."""
    return _encoder_for(embedding_backend())


def clear_encoder_cache() -> None:
    _encoder_for.cache_clear()
