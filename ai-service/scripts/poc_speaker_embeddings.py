"""
POC: Can we distinguish two voices on Freshcaller mono 8 kHz audio?

Backends:
  - spectral: lightweight log-mel mean (baseline; usually weak on telephony)
  - ecapa: SpeechBrain ECAPA-TDNN speaker embeddings (CPU)

Does not modify production pipeline.
Resamples an inference copy to 16 kHz; does not restore missing HF content.
"""

from __future__ import annotations

import argparse
import json
import math
import wave
from pathlib import Path

import numpy as np


def load_wav_mono(path: Path) -> tuple[np.ndarray, int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        width = wf.getsampwidth()
        raw = wf.readframes(n)
    if width == 2:
        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    else:
        raise RuntimeError(f"Unsupported sample width {width}")
    if ch > 1:
        audio = audio.reshape(-1, ch).mean(axis=1)
    return audio, sr


def resample_linear(audio: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return audio
    n_out = int(round(len(audio) * sr_out / sr_in))
    if n_out <= 1:
        return audio[:1]
    x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
    return np.interp(x_new, x_old, audio).astype(np.float32)


def slice_sec(audio: np.ndarray, sr: int, start: float, end: float) -> np.ndarray:
    a = max(0, int(start * sr))
    b = min(len(audio), int(math.ceil(end * sr)))
    return audio[a:b]


def mfcc_like(seg: np.ndarray, sr: int, n_mels: int = 20) -> np.ndarray:
    """Lightweight log-mel mean vector (not calibrated probability)."""
    if len(seg) < max(256, int(0.2 * sr)):
        return np.zeros(n_mels, dtype=np.float32)
    win = int(0.025 * sr)
    hop = int(0.010 * sr)
    if win < 16:
        win = 16
    frames = []
    for i in range(0, max(1, len(seg) - win), hop):
        frame = seg[i : i + win]
        if len(frame) < win:
            break
        frame = frame * np.hanning(win)
        spec = np.abs(np.fft.rfft(frame)) ** 2
        frames.append(spec)
    if not frames:
        return np.zeros(n_mels, dtype=np.float32)
    S = np.stack(frames, axis=0)
    bins = S.shape[1]
    edges = np.linspace(0, bins, n_mels + 1).astype(int)
    feats = []
    for i in range(n_mels):
        lo, hi = edges[i], max(edges[i] + 1, edges[i + 1])
        feats.append(np.log1p(S[:, lo:hi].mean(axis=1)).mean())
    v = np.asarray(feats, dtype=np.float32)
    return v / (np.linalg.norm(v) + 1e-8)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    if a.shape != b.shape or np.linalg.norm(a) < 1e-8 or np.linalg.norm(b) < 1e-8:
        return 0.0
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def find_islands(utts: list[dict], max_dur: float = 3.0) -> list[dict]:
    islands = []
    for i, u in enumerate(utts):
        if i == 0 or i == len(utts) - 1:
            continue
        prev_s, next_s = utts[i - 1]["speaker"], utts[i + 1]["speaker"]
        if prev_s == next_s and u["speaker"] != prev_s:
            dur = float(u["end"]) - float(u["start"])
            if dur <= max_dur:
                islands.append({"index": i, "utt": u, "neighbor": prev_s, "dur": dur})
    return islands


class SpectralEncoder:
    name = "spectral"

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray:
        return mfcc_like(seg, sr)


class EcapaEncoder:
    """Load ECAPA-TDNN embedding model from local SpeechBrain checkpoints (CPU)."""

    name = "ecapa"

    def __init__(self, savedir: Path) -> None:
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
        ckpt = savedir / "embedding_model.ckpt"
        state = torch.load(str(ckpt), map_location="cpu", weights_only=False)
        # SpeechBrain checkpoints are often {"model": state_dict} or raw state_dict
        if isinstance(state, dict) and "model" in state and isinstance(state["model"], dict):
            state = state["model"]
        self.embedding_model.load_state_dict(state)
        self.embedding_model.eval()
        self.embedding_model.to(self.device)
        # Dummy wav lens tensor helper
        self._wav_lens = None

    def encode(self, seg: np.ndarray, sr: int) -> np.ndarray:
        if len(seg) < int(0.25 * sr):
            return np.zeros(192, dtype=np.float32)
        wav = self.torch.from_numpy(seg).float().unsqueeze(0)  # [1, T]
        wav_lens = self.torch.ones(1)
        with self.torch.no_grad():
            feats = self.compute_features(wav)
            feats = self.mean_var_norm(feats, wav_lens)
            emb = self.embedding_model(feats)
        v = emb.squeeze().cpu().numpy().astype(np.float32)
        if v.ndim > 1:
            v = v.reshape(-1)
        return v / (np.linalg.norm(v) + 1e-8)


def build_profiles(
    utts: list[dict],
    speakers: list[str],
    audio: np.ndarray,
    sr: int,
    encoder,
    min_sec: float,
    exclude_indices: set[int],
) -> dict[str, np.ndarray]:
    profiles: dict[str, np.ndarray] = {}
    for sp in speakers:
        chunks = []
        for i, u in enumerate(utts):
            if i in exclude_indices:
                continue
            if u["speaker"] != sp:
                continue
            dur = float(u["end"]) - float(u["start"])
            if dur < min_sec:
                continue
            # Trim 50ms edges to reduce bleed
            start = float(u["start"]) + 0.05
            end = float(u["end"]) - 0.05
            if end - start < 0.2:
                continue
            chunks.append(encoder.encode(slice_sec(audio, sr, start, end), sr))
        if chunks:
            v = np.mean(np.stack(chunks), axis=0)
            profiles[sp] = v / (np.linalg.norm(v) + 1e-8)
            print(f"profile {sp}: from {len(chunks)} reliable segments (>= {min_sec}s, islands excluded)")
        else:
            print(f"profile {sp}: FAILED")
    return profiles


def score_region(seg: np.ndarray, sr: int, encoder, profiles: dict[str, np.ndarray]) -> dict:
    emb = encoder.encode(seg, sr)
    scores = {sp: cosine(emb, profiles[sp]) for sp in profiles}
    if not scores:
        return {"scores": {}, "best": None, "margin": 0.0}
    best = max(scores, key=scores.get)
    ordered = sorted(scores.values(), reverse=True)
    margin = ordered[0] - ordered[1] if len(ordered) >= 2 else 0.0
    return {"scores": scores, "best": best, "margin": margin}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--utterances-json", required=True)
    parser.add_argument("--min-profile-sec", type=float, default=1.5)
    parser.add_argument("--backend", choices=["spectral", "ecapa"], default="spectral")
    parser.add_argument("--model-dir", default=str(Path(__file__).resolve().parents[1] / ".cache" / "speechbrain-ecapa"))
    args = parser.parse_args()

    audio_path = Path(args.audio)
    utts = json.loads(Path(args.utterances_json).read_text(encoding="utf-8"))
    audio, sr = load_wav_mono(audio_path)
    print(f"audio={audio_path.name} sr={sr} channels=1 duration={len(audio)/sr:.2f}s")
    print("NOTE: inference copy resampled to 16 kHz; 8 kHz bandwidth is NOT restored.")

    audio16 = resample_linear(audio, sr, 16000)
    sr_work = 16000

    if args.backend == "ecapa":
        print("Loading SpeechBrain ECAPA (CPU)…")
        encoder = EcapaEncoder(Path(args.model_dir))
    else:
        encoder = SpectralEncoder()
    print(f"backend={encoder.name}")

    speakers = sorted({u["speaker"] for u in utts})
    print(f"speakers={speakers} utterances={len(utts)}")

    islands = find_islands(utts)
    exclude = {item["index"] for item in islands}
    profiles = build_profiles(utts, speakers, audio16, sr_work, encoder, args.min_profile_sec, exclude)

    if len(profiles) >= 2:
        keys = list(profiles.keys())
        sep = cosine(profiles[keys[0]], profiles[keys[1]])
        print(f"profile_separation cosine({keys[0]},{keys[1]})={sep:.3f}")
        print("(Lower = better separation; ~0.95+ spectral often means poorly separable)")

    # Duration sweep for short utterances
    print("--- duration_sweep on islands ---")
    print(f"suspicious_islands={len(islands)}")
    for item in islands:
        u = item["utt"]
        # Context window: prev stable + region + next stable
        prev = utts[item["index"] - 1]
        nxt = utts[item["index"] + 1]
        region = score_region(
            slice_sec(audio16, sr_work, float(u["start"]), float(u["end"])),
            sr_work,
            encoder,
            profiles,
        )
        ctx_start = float(prev["start"])
        ctx_end = float(nxt["end"])
        ctx = score_region(
            slice_sec(audio16, sr_work, ctx_start, ctx_end),
            sr_work,
            encoder,
            profiles,
        )
        aai = u["speaker"]
        ground_hypothesis = item["neighbor"]  # island between same neighbors often same speaker
        print(
            f"  island@{u['start']:.2f}-{u['end']:.2f}s aai={aai} neighbor={item['neighbor']} "
            f"dur={item['dur']:.2f}s "
            f"region_best={region['best']} margin={region['margin']:.3f} "
            f"scores={{{', '.join(f'{k}:{v:.3f}' for k,v in region['scores'].items())}}} "
            f"ctx_best={ctx['best']} ctx_margin={ctx['margin']:.3f} "
            f"hypothesis_same_as_neighbor={ground_hypothesis} "
            f"text={u.get('text','')[:50]!r}"
        )

    # Profile self-consistency: long turns should match their label
    print("--- self_consistency (long turns vs profiles) ---")
    agree = 0
    total = 0
    for i, u in enumerate(utts):
        if i in exclude:
            continue
        dur = float(u["end"]) - float(u["start"])
        if dur < args.min_profile_sec:
            continue
        r = score_region(
            slice_sec(audio16, sr_work, float(u["start"]) + 0.05, float(u["end"]) - 0.05),
            sr_work,
            encoder,
            profiles,
        )
        total += 1
        ok = r["best"] == u["speaker"]
        if ok:
            agree += 1
        else:
            print(
                f"  MISMATCH @{u['start']:.2f}-{u['end']:.2f}s label={u['speaker']} "
                f"best={r['best']} margin={r['margin']:.3f} text={u.get('text','')[:40]!r}"
            )
    print(f"self_consistency={agree}/{total}" if total else "self_consistency=n/a")


if __name__ == "__main__":
    main()
