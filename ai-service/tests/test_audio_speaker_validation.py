"""Unit tests for audio-based speaker validation (no torch required)."""

from __future__ import annotations

import numpy as np
import pytest

from app.pipeline.audio_speaker_validation import (
    EcapaUnavailableError,
    ValidationConfig,
    audio_speaker_validation_enabled,
    decide_validation,
    find_speaker_islands,
    maybe_validate_speakers,
    rebuild_utterances_from_words,
    validate_speakers_audio,
)
from app.pipeline.speaker_mapping import map_speakers
from app.schemas import DiarizedUtterance, DiarizedWord


def _utt(speaker: str, start: float, end: float, text: str = "x") -> DiarizedUtterance:
    return DiarizedUtterance(speaker=speaker, start=start, end=end, text=text)


def test_stable_run_no_islands():
    speakers = ["A", "A", "A", "A", "A"]
    starts = [0.0, 1.0, 2.0, 3.0, 4.0]
    ends = [1.0, 2.0, 3.0, 4.0, 5.0]
    assert find_speaker_islands(speakers, starts, ends, max_dur=3.0) == []


def test_island_aaa_b_aaa_detected():
    speakers = ["A", "A", "A", "B", "A", "A", "A"]
    starts = [0, 1, 2, 3, 4, 5, 6]
    ends = [1, 2, 3, 4.2, 5, 6, 7]
    islands = find_speaker_islands(speakers, starts, ends, max_dur=3.0)
    assert len(islands) == 1
    assert islands[0]["index"] == 3
    assert islands[0]["neighbor"] == "A"


def test_genuine_switch_a_a_a_b_b_b_not_island():
    speakers = ["A", "A", "A", "B", "B", "B"]
    starts = [0, 1, 2, 3, 4, 5]
    ends = [1, 2, 3, 4, 5, 6]
    assert find_speaker_islands(speakers, starts, ends, max_dur=3.0) == []


def test_short_island_insufficient_audio_keeps_original():
    cfg = ValidationConfig(min_speech_sec=1.0, correct_margin=0.15, confirm_margin=0.08)
    validated, status, reason, _ = decide_validation(
        original="B",
        neighbor="A",
        best="A",
        margin=0.5,
        dur=0.4,
        scores={"A": 0.9, "B": 0.4},
        cfg=cfg,
    )
    assert validated == "B"
    assert status == "insufficient_audio"
    assert reason == "short_utterance"


def test_assemblyai_matches_audio_confirmed():
    cfg = ValidationConfig(min_speech_sec=0.5, correct_margin=0.15, confirm_margin=0.08)
    validated, status, reason, score = decide_validation(
        original="B",
        neighbor="A",
        best="B",
        margin=0.2,
        dur=1.5,
        scores={"A": 0.3, "B": 0.5},
        cfg=cfg,
    )
    assert validated == "B"
    assert status == "confirmed"
    assert score == 0.5


def test_strong_audio_disagreement_corrects():
    cfg = ValidationConfig(min_speech_sec=0.5, correct_margin=0.15, confirm_margin=0.08)
    validated, status, reason, score = decide_validation(
        original="B",
        neighbor="A",
        best="A",
        margin=0.25,
        dur=1.7,
        scores={"A": 0.7, "B": 0.45},
        cfg=cfg,
    )
    assert validated == "A"
    assert status == "corrected"
    assert reason == "acoustic_similarity"
    assert score == 0.7


def test_weak_margin_uncertain_keeps_original():
    cfg = ValidationConfig(min_speech_sec=0.5, correct_margin=0.15, confirm_margin=0.08)
    validated, status, reason, _ = decide_validation(
        original="B",
        neighbor="A",
        best="A",
        margin=0.02,
        dur=1.7,
        scores={"A": 0.401, "B": 0.399},
        cfg=cfg,
    )
    assert validated == "B"
    assert status == "uncertain"


def test_rebuild_utterances_preserves_timestamps():
    words = [
        DiarizedWord(speaker="A", start=0.0, end=0.2, word="hi"),
        DiarizedWord(speaker="A", start=0.2, end=0.5, word="there"),
        DiarizedWord(speaker="B", start=0.6, end=0.9, word="hello"),
        DiarizedWord(speaker="A", start=1.0, end=1.3, word="ok"),
    ]
    utts = rebuild_utterances_from_words(words)
    assert len(utts) == 3
    assert utts[0].speaker == "A" and utts[0].start == 0.0 and utts[0].end == 0.5
    assert utts[1].speaker == "B" and utts[1].start == 0.6
    assert utts[2].speaker == "A"


def _profile_embed(start: float, end: float) -> np.ndarray:
    """Injected embedder: early region mimics A, mid island mimics A, late mimics B."""
    mid = (start + end) / 2.0
    if mid < 5.0:
        return np.array([1.0, 0.0, 0.0], dtype=np.float32)
    if mid < 8.0:
        # Suspicious island acoustically matches A
        return np.array([0.95, 0.05, 0.0], dtype=np.float32)
    return np.array([0.0, 1.0, 0.0], dtype=np.float32)


def test_end_to_end_correction_with_injected_embed(monkeypatch):
    monkeypatch.setenv("AUDIO_SPEAKER_VALIDATION", "true")
    # Pattern A A A B A A A then genuine B B — only one island (mislabeled B).
    utterances = [
        _utt("A", 0.0, 2.0, "hello from agent"),
        _utt("A", 2.0, 4.0, "more agent talk"),
        _utt("A", 4.0, 5.5, "still agent"),
        _utt("B", 5.5, 7.2, "I was trying to connect with"),  # island → correct to A
        _utt("A", 7.2, 9.0, "Kevin please"),
        _utt("A", 9.0, 11.0, "agent continues"),
        _utt("A", 11.0, 12.5, "agent wrap"),
        _utt("B", 12.5, 16.0, "customer long turn here"),
        _utt("B", 16.0, 20.0, "customer again"),
    ]

    def embed(start: float, end: float) -> np.ndarray:
        mid = (start + end) / 2.0
        # Acoustically agent until 12.5s (including the mislabeled island).
        if mid < 12.5:
            return np.array([1.0, 0.0, 0.0], dtype=np.float32)
        return np.array([0.0, 1.0, 0.0], dtype=np.float32)

    words = [
        DiarizedWord(speaker=u.speaker, start=u.start, end=u.end, word=u.text.split()[0])
        for u in utterances
    ]
    cfg = ValidationConfig(min_profile_sec=1.5, min_speech_sec=1.0, correct_margin=0.15, island_max_sec=3.0)
    out_utts, out_words, summary = validate_speakers_audio(
        audio_path="unused.wav",
        utterances=utterances,
        words=words,
        embed_fn=embed,
        cfg=cfg,
        recording_id="test",
    )
    assert summary.suspicious_regions_count == 1
    assert summary.corrections_count == 1
    corrected = [
        u
        for u in out_utts
        if u.speaker_validation
        and u.speaker_validation.speaker_validation_status == "corrected"
    ]
    assert len(corrected) == 1
    assert corrected[0].speaker == "A"
    assert corrected[0].speaker_validation is not None
    assert corrected[0].speaker_validation.original_speaker == "B"
    assert any(
        w.speaker_validation
        and w.speaker_validation.original_speaker == "B"
        and w.speaker == "A"
        for w in out_words
    )


def test_maybe_validate_enabled_by_default(monkeypatch):
    monkeypatch.delenv("AUDIO_SPEAKER_VALIDATION", raising=False)
    assert audio_speaker_validation_enabled() is True


def test_maybe_validate_emergency_off(monkeypatch):
    monkeypatch.setenv("AUDIO_SPEAKER_VALIDATION", "false")
    utts = [_utt("A", 0, 1), _utt("B", 1, 2)]
    words: list[DiarizedWord] = []
    out_u, out_w, summary = maybe_validate_speakers(
        audio_path="/tmp/x.wav",
        utterances=utts,
        words=words,
        skip=False,
    )
    assert summary.enabled is False
    assert summary.status == "disabled"
    assert out_u[0].speaker == "A"


def test_maybe_validate_missing_ecapa_raises(monkeypatch):
    monkeypatch.setenv("AUDIO_SPEAKER_VALIDATION", "true")
    monkeypatch.setattr(
        "app.pipeline.audio_speaker_validation.ecapa_available",
        lambda: False,
    )
    with pytest.raises(EcapaUnavailableError, match="required but unavailable"):
        maybe_validate_speakers(
            audio_path="/tmp/x.wav",
            utterances=[_utt("A", 0, 1), _utt("B", 1, 2)],
            words=[],
            skip=False,
        )


def test_remap_skip_flag_does_not_require_audio(monkeypatch):
    monkeypatch.setenv("AUDIO_SPEAKER_VALIDATION", "true")
    utts = [_utt("A", 0, 2, "agent pitch"), _utt("B", 2, 4, "customer reply")]
    out_u, _, summary = maybe_validate_speakers(
        audio_path=None,
        utterances=utts,
        words=[],
        skip=True,
    )
    assert summary.status == "disabled" or summary.enabled is False or summary.status == "skipped"
    # skip=True → disabled path
    assert summary.enabled is False
    assert out_u[0].speaker == "A"


def test_map_speakers_still_works_after_validation_fields():
    utts = [
        _utt("A", 0, 3, "Hi this is Surbhi from Data Fortune"),
        _utt("B", 3, 5, "Hello"),
    ]
    result = map_speakers(utts, {"direction": "outgoing", "agentName": "Surbhi"})
    assert result.agent_speaker in {"A", "B"}
    assert set(result.mapping.values()) <= {"agent", "customer"}
