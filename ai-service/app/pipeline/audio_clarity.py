"""Audio-clarity flag (F10): ASR word confidence + simple WAV acoustics.

Does not change scoring formulas. Analysis always proceeds; this is a reliability warning.
"""

from __future__ import annotations

import os
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Sequence

from app.schemas import DiarizedUtterance, DiarizedWord, LowConfidenceSpan, SpeakerAudioClarity

AudioClarityFlag = Literal["ok", "caution", "poor"]

REASON_LOW_ASR = "low_asr_confidence"
REASON_MANY_UNCERTAIN = "many_uncertain_words"
REASON_CLIPPING = "clipping"
REASON_TOO_QUIET = "too_quiet"
REASON_HIGH_SILENCE = "high_silence"

SPAN_CAP = 50


def _env_float(name: str, default: float) -> float:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _thresholds() -> dict[str, float]:
    return {
        "mean_poor": _env_float("AUDIO_CLARITY_MEAN_POOR", 0.50),
        "mean_caution": _env_float("AUDIO_CLARITY_MEAN_CAUTION", 0.70),
        "low_word": _env_float("AUDIO_CLARITY_LOW_WORD", 0.40),
        "low_pct_poor": _env_float("AUDIO_CLARITY_LOW_PCT_POOR", 0.30),
        "low_pct_caution": _env_float("AUDIO_CLARITY_LOW_PCT_CAUTION", 0.15),
        "clip_poor": _env_float("AUDIO_CLARITY_CLIP_POOR", 0.01),
        "clip_caution": _env_float("AUDIO_CLARITY_CLIP_CAUTION", 0.001),
        "rms_poor": _env_float("AUDIO_CLARITY_RMS_POOR", 0.008),
        "rms_caution": _env_float("AUDIO_CLARITY_RMS_CAUTION", 0.02),
        "silence_poor": _env_float("AUDIO_CLARITY_SILENCE_POOR", 70.0),
        "silence_caution": _env_float("AUDIO_CLARITY_SILENCE_CAUTION", 50.0),
        "clip_abs": _env_float("AUDIO_CLARITY_CLIP_ABS", 0.99),
    }


@dataclass
class AcousticStats:
    clipping_pct: float | None = None
    rms: float | None = None
    peak: float | None = None


@dataclass
class AudioClarityAssessment:
    flag: AudioClarityFlag = "ok"
    reasons: list[str] = field(default_factory=list)
    avg_asr_confidence: float | None = None
    p10_asr_confidence: float | None = None
    low_confidence_word_pct: float | None = None
    clipping_pct: float | None = None
    rms: float | None = None
    low_confidence_spans: list[LowConfidenceSpan] = field(default_factory=list)


def _confidence_values(
    words: Sequence[DiarizedWord],
    utterances: Sequence[DiarizedUtterance],
) -> list[tuple[float, float, float, str, str]]:
    """Return (confidence, start, end, word, speaker) for items that have confidence."""
    rows: list[tuple[float, float, float, str, str]] = []
    for word in words:
        if word.confidence is None:
            continue
        rows.append((float(word.confidence), float(word.start), float(word.end), word.word, word.speaker))
    if rows:
        return rows
    for utt in utterances:
        if utt.confidence is None:
            continue
        rows.append((float(utt.confidence), float(utt.start), float(utt.end), utt.text[:80], utt.speaker))
    return rows


def _percentile(sorted_vals: list[float], p: float) -> float | None:
    if not sorted_vals:
        return None
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = min(len(sorted_vals) - 1, max(0, int(round((p / 100.0) * (len(sorted_vals) - 1)))))
    return sorted_vals[idx]


def load_wav_floats(path: str | Path) -> tuple[list[float], int]:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate()
        n = wf.getnframes()
        ch = wf.getnchannels()
        width = wf.getsampwidth()
        raw = wf.readframes(n)
    if width != 2:
        raise RuntimeError(f"Unsupported sample width {width}; expected 16-bit PCM")
    try:
        import numpy as np

        audio = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if ch > 1:
            audio = audio.reshape(-1, ch).mean(axis=1)
        return audio.tolist(), sr
    except ImportError:
        import struct

        count = len(raw) // 2
        ints = struct.unpack("<" + "h" * count, raw)
        if ch <= 1:
            return [v / 32768.0 for v in ints], sr
        frames = count // ch
        out: list[float] = []
        for i in range(frames):
            acc = 0.0
            for c in range(ch):
                acc += ints[i * ch + c] / 32768.0
            out.append(acc / ch)
        return out, sr


def _stats_from_samples(samples: Sequence[float]) -> AcousticStats:
    if not samples:
        return AcousticStats(clipping_pct=0.0, rms=0.0, peak=0.0)
    clip_abs = _thresholds()["clip_abs"]
    n = len(samples)
    clipped = 0
    sum_sq = 0.0
    peak = 0.0
    for sample in samples:
        mag = abs(sample)
        if mag > peak:
            peak = mag
        if mag >= clip_abs:
            clipped += 1
        sum_sq += sample * sample
    rms = (sum_sq / n) ** 0.5
    return AcousticStats(
        clipping_pct=round(100.0 * clipped / n, 4),
        rms=round(float(rms), 5),
        peak=round(float(peak), 4),
    )


def measure_wav_acoustics(audio_path: str | None) -> AcousticStats:
    if not audio_path:
        return AcousticStats()
    path = Path(audio_path)
    if not path.is_file():
        return AcousticStats()
    try:
        samples, _sr = load_wav_floats(path)
    except Exception:
        return AcousticStats()
    return _stats_from_samples(samples)


def measure_wav_windows(
    audio_path: str | None,
    windows: Sequence[tuple[float, float]],
    *,
    samples: Sequence[float] | None = None,
    sample_rate: int | None = None,
) -> AcousticStats:
    if samples is None:
        if not audio_path:
            return AcousticStats()
        path = Path(audio_path)
        if not path.is_file():
            return AcousticStats()
        try:
            samples, sample_rate = load_wav_floats(path)
        except Exception:
            return AcousticStats()
    if not samples or not sample_rate or not windows:
        return AcousticStats()
    chunk: list[float] = []
    n = len(samples)
    for start, end in windows:
        a = max(0, int(start * sample_rate))
        b = min(n, int(max(start, end) * sample_rate))
        if b > a:
            chunk.extend(samples[a:b])
    if not chunk:
        return AcousticStats()
    return _stats_from_samples(chunk)


def worse_flag(*flags: AudioClarityFlag | None) -> AudioClarityFlag:
    rank = {"ok": 0, "caution": 1, "poor": 2}
    best: AudioClarityFlag = "ok"
    for flag in flags:
        if flag and rank.get(flag, 0) > rank[best]:
            best = flag
    return best


def assess_audio_clarity(
    *,
    words: Sequence[DiarizedWord],
    utterances: Sequence[DiarizedUtterance] | None = None,
    avg_asr_confidence: float | None = None,
    silence_ratio_pct: float | None = None,
    audio_path: str | None = None,
    acoustics: AcousticStats | None = None,
    include_rms: bool = True,
    include_silence: bool = True,
) -> AudioClarityAssessment:
    th = _thresholds()
    rows = _confidence_values(words, utterances or [])
    confs = [row[0] for row in rows]
    mean_conf = (sum(confs) / len(confs)) if confs else avg_asr_confidence
    sorted_confs = sorted(confs)
    p10 = _percentile(sorted_confs, 10)
    low_word = th["low_word"]
    low_count = sum(1 for c in confs if c < low_word)
    low_pct = (low_count / len(confs)) if confs else None

    spans: list[LowConfidenceSpan] = []
    for conf, start, end, token, speaker in rows:
        if conf < low_word:
            spans.append(
                LowConfidenceSpan(
                    start=round(start, 3),
                    end=round(end, 3),
                    word=token,
                    confidence=round(conf, 4),
                    speaker=speaker,
                )
            )
            if len(spans) >= SPAN_CAP:
                break

    stats = acoustics if acoustics is not None else measure_wav_acoustics(audio_path)
    clip_frac = None if stats.clipping_pct is None else stats.clipping_pct / 100.0

    poor = False
    caution = False
    reasons: list[str] = []

    if mean_conf is not None:
        if mean_conf < th["mean_poor"]:
            poor = True
            reasons.append(REASON_LOW_ASR)
        elif mean_conf < th["mean_caution"]:
            caution = True
            if REASON_LOW_ASR not in reasons:
                reasons.append(REASON_LOW_ASR)

    if low_pct is not None:
        if low_pct >= th["low_pct_poor"]:
            poor = True
            if REASON_MANY_UNCERTAIN not in reasons:
                reasons.append(REASON_MANY_UNCERTAIN)
        elif low_pct >= th["low_pct_caution"]:
            caution = True
            if REASON_MANY_UNCERTAIN not in reasons:
                reasons.append(REASON_MANY_UNCERTAIN)

    if clip_frac is not None:
        if clip_frac >= th["clip_poor"]:
            poor = True
            if REASON_CLIPPING not in reasons:
                reasons.append(REASON_CLIPPING)
        elif clip_frac >= th["clip_caution"]:
            caution = True
            if REASON_CLIPPING not in reasons:
                reasons.append(REASON_CLIPPING)

    if include_rms and stats.rms is not None:
        if stats.rms < th["rms_poor"]:
            poor = True
            if REASON_TOO_QUIET not in reasons:
                reasons.append(REASON_TOO_QUIET)
        elif stats.rms < th["rms_caution"]:
            caution = True
            if REASON_TOO_QUIET not in reasons:
                reasons.append(REASON_TOO_QUIET)

    if include_silence and silence_ratio_pct is not None:
        if silence_ratio_pct >= th["silence_poor"]:
            poor = True
            if REASON_HIGH_SILENCE not in reasons:
                reasons.append(REASON_HIGH_SILENCE)
        elif silence_ratio_pct >= th["silence_caution"]:
            caution = True
            if REASON_HIGH_SILENCE not in reasons:
                reasons.append(REASON_HIGH_SILENCE)

    if poor:
        flag: AudioClarityFlag = "poor"
    elif caution:
        flag = "caution"
    else:
        flag = "ok"
        reasons = []

    # Keep reason order stable and unique
    ordered = []
    for code in (
        REASON_LOW_ASR,
        REASON_MANY_UNCERTAIN,
        REASON_CLIPPING,
        REASON_TOO_QUIET,
        REASON_HIGH_SILENCE,
    ):
        if code in reasons and code not in ordered:
            ordered.append(code)

    return AudioClarityAssessment(
        flag=flag,
        reasons=ordered,
        avg_asr_confidence=round(mean_conf, 4) if mean_conf is not None else None,
        p10_asr_confidence=round(p10, 4) if p10 is not None else None,
        low_confidence_word_pct=round(low_pct * 100.0, 1) if low_pct is not None else None,
        clipping_pct=stats.clipping_pct,
        rms=stats.rms,
        low_confidence_spans=spans,
    )


def assess_speakers_audio_clarity(
    *,
    words: Sequence[DiarizedWord],
    utterances: Sequence[DiarizedUtterance],
    role_hints: dict[str, str] | None = None,
    audio_path: str | None = None,
) -> list[SpeakerAudioClarity]:
    """Per-speaker ASR confidence plus acoustics on that speaker's talk windows only."""
    roles = role_hints or {}
    speakers = sorted({w.speaker for w in words} | {u.speaker for u in utterances})
    samples: list[float] | None = None
    sample_rate: int | None = None
    if audio_path:
        path = Path(audio_path)
        if path.is_file():
            try:
                loaded, sr = load_wav_floats(path)
                samples, sample_rate = loaded, sr
            except Exception:
                samples, sample_rate = None, None

    out: list[SpeakerAudioClarity] = []
    for speaker in speakers:
        role = roles.get(speaker)
        if role == "bot":
            continue
        speaker_words = [w for w in words if w.speaker == speaker]
        speaker_utts = [u for u in utterances if u.speaker == speaker]
        windows = [(u.start, u.end) for u in speaker_utts if u.end > u.start]
        acoustics = measure_wav_windows(
            audio_path,
            windows,
            samples=samples,
            sample_rate=sample_rate,
        )
        assessed = assess_audio_clarity(
            words=speaker_words,
            utterances=speaker_utts,
            acoustics=acoustics if acoustics.rms is not None else AcousticStats(),
            include_silence=False,
        )
        out.append(
            SpeakerAudioClarity(
                speaker=speaker,
                role=role,
                flag=assessed.flag,
                reasons=assessed.reasons,
                avg_asr_confidence=assessed.avg_asr_confidence,
                low_confidence_word_pct=assessed.low_confidence_word_pct,
                clipping_pct=assessed.clipping_pct,
                rms=assessed.rms,
            )
        )
    role_rank = {"agent": 0, "customer": 1}
    out.sort(key=lambda item: (role_rank.get(item.role or "", 9), item.speaker))
    return out
