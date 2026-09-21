"""F10 audio-clarity flag thresholds and WAV acoustics."""

from __future__ import annotations

import math
import wave
from pathlib import Path

import numpy as np

from app.pipeline.audio_clarity import AcousticStats, assess_audio_clarity
from app.schemas import DiarizedWord


def _word(text: str, conf: float, start: float = 0.0) -> DiarizedWord:
    return DiarizedWord(speaker="A", start=start, end=start + 0.3, word=text, confidence=conf)


def _write_wav(path: Path, samples: np.ndarray, sr: int = 8000) -> None:
    pcm = np.clip(samples, -1.0, 1.0)
    frames = (pcm * 32767.0).astype(np.int16).tobytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(frames)


def test_poor_when_mean_confidence_low():
    words = [_word("hello", 0.40), _word("there", 0.42), _word("thanks", 0.38)]
    result = assess_audio_clarity(words=words, acoustics=AcousticStats(clipping_pct=0.0, rms=0.1))
    assert result.flag == "poor"
    assert "low_asr_confidence" in result.reasons
    assert result.avg_asr_confidence is not None and result.avg_asr_confidence < 0.50


def test_poor_when_many_uncertain_words():
    words = [_word(f"w{i}", 0.90 if i < 6 else 0.20, start=float(i)) for i in range(10)]
    result = assess_audio_clarity(words=words, acoustics=AcousticStats(clipping_pct=0.0, rms=0.1))
    assert result.flag == "poor"
    assert "many_uncertain_words" in result.reasons
    assert result.low_confidence_word_pct == 40.0
    assert len(result.low_confidence_spans) == 4


def test_caution_when_mean_in_mid_band():
    words = [_word("hello", 0.60), _word("there", 0.62), _word("thanks", 0.58)]
    result = assess_audio_clarity(words=words, acoustics=AcousticStats(clipping_pct=0.0, rms=0.1))
    assert result.flag == "caution"
    assert "low_asr_confidence" in result.reasons


def test_caution_when_15_to_30_percent_low_words():
    words = [_word(f"w{i}", 0.90 if i < 8 else 0.30, start=float(i)) for i in range(10)]
    result = assess_audio_clarity(words=words, acoustics=AcousticStats(clipping_pct=0.0, rms=0.1))
    assert result.flag == "caution"
    assert "many_uncertain_words" in result.reasons
    assert result.low_confidence_word_pct == 20.0


def test_ok_when_high_confidence():
    words = [_word("hello", 0.92), _word("there", 0.88), _word("thanks", 0.95)]
    result = assess_audio_clarity(words=words, acoustics=AcousticStats(clipping_pct=0.0, rms=0.12))
    assert result.flag == "ok"
    assert result.reasons == []
    assert result.low_confidence_spans == []


def test_clipped_wav_is_poor(tmp_path: Path):
    samples = np.ones(4000, dtype=np.float32)
    wav = tmp_path / "clipped.wav"
    _write_wav(wav, samples)
    words = [_word("hello", 0.92), _word("there", 0.90)]
    result = assess_audio_clarity(words=words, audio_path=str(wav))
    assert result.flag == "poor"
    assert "clipping" in result.reasons
    assert result.clipping_pct is not None and result.clipping_pct > 50


def test_clean_sine_wav_stays_ok(tmp_path: Path):
    sr = 8000
    t = np.arange(sr, dtype=np.float32) / sr
    samples = (0.3 * np.sin(2 * math.pi * 440 * t)).astype(np.float32)
    wav = tmp_path / "clean.wav"
    _write_wav(wav, samples, sr=sr)
    words = [_word("hello", 0.92), _word("there", 0.90), _word("thanks", 0.88)]
    result = assess_audio_clarity(words=words, audio_path=str(wav), silence_ratio_pct=10.0)
    assert result.flag == "ok"
    assert result.reasons == []


def test_near_silence_wav_is_poor(tmp_path: Path):
    samples = np.full(4000, 0.001, dtype=np.float32)
    wav = tmp_path / "quiet.wav"
    _write_wav(wav, samples)
    words = [_word("hello", 0.92)]
    result = assess_audio_clarity(words=words, audio_path=str(wav))
    assert result.flag == "poor"
    assert "too_quiet" in result.reasons


def test_speaker_flags_are_independent():
    words = [
        DiarizedWord(speaker="A", start=0.0, end=0.3, word="hello", confidence=0.92),
        DiarizedWord(speaker="A", start=0.3, end=0.6, word="there", confidence=0.90),
        DiarizedWord(speaker="B", start=1.0, end=1.3, word="what", confidence=0.32),
        DiarizedWord(speaker="B", start=1.3, end=1.6, word="sorry", confidence=0.28),
        DiarizedWord(speaker="B", start=1.6, end=1.9, word="noise", confidence=0.30),
    ]
    from app.schemas import DiarizedUtterance

    utterances = [
        DiarizedUtterance(speaker="A", start=0.0, end=0.6, text="hello there", confidence=0.91),
        DiarizedUtterance(speaker="B", start=1.0, end=1.9, text="what sorry noise", confidence=0.30),
    ]
    from app.pipeline.audio_clarity import assess_speakers_audio_clarity

    rows = assess_speakers_audio_clarity(
        words=words,
        utterances=utterances,
        role_hints={"A": "agent", "B": "customer"},
    )
    by_role = {row.role: row.flag for row in rows}
    assert by_role["agent"] == "ok"
    assert by_role["customer"] == "poor"


def test_poor_outranks_caution_mean():
    words = [_word("a", 0.55), _word("b", 0.55)]
    result = assess_audio_clarity(
        words=words,
        acoustics=AcousticStats(clipping_pct=5.0, rms=0.1),
    )
    assert result.flag == "poor"
    assert "clipping" in result.reasons
