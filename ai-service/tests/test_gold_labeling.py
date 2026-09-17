"""Tests for offline gold labeling store / export / validate (no diarization changes)."""

from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np
import pytest

# scripts/ on path
import sys

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from gold_labeling.audio_clip import clip_wav_bytes  # noqa: E402
from gold_labeling.schema import is_excluded_label, is_score_label, segment_id  # noqa: E402
from gold_labeling.store import GoldLabelStore  # noqa: E402
from gold_labeling.validate import validate_store  # noqa: E402


def _write_wav(path: Path, *, duration_sec: float = 5.0, sr: int = 8000) -> None:
    n = int(duration_sec * sr)
    # tiny silence
    frames = (np.zeros(n, dtype=np.int16)).tobytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(frames)


def _write_template(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


@pytest.fixture()
def gold_env(tmp_path: Path):
    repo = tmp_path / "repo"
    audio_rel = "backend/data/fc-recordings/fc_test_1.wav"
    audio = repo / audio_rel
    _write_wav(audio, duration_sec=10.0)

    gold = tmp_path / "gold"
    templates = gold / "templates"
    rows = [
        {
            "callId": "100",
            "recordingId": "1",
            "audioPath": audio_rel,
            "startMs": 1000,
            "endMs": 2500,
            "text": "Hello there",
            "assemblyAiSpeaker": "A",
            "goldSpeaker": None,
            "segmentType": "stable_turn",
        },
        {
            "callId": "100",
            "recordingId": "1",
            "audioPath": audio_rel,
            "startMs": 3000,
            "endMs": 3500,
            "text": "Sure.",
            "assemblyAiSpeaker": "B",
            "goldSpeaker": None,
            "segmentType": "short_response",
        },
        {
            "callId": "100",
            "recordingId": "1",
            "audioPath": audio_rel,
            "startMs": 4000,
            "endMs": 7000,
            "text": "Long turn",
            "assemblyAiSpeaker": "A",
            "goldSpeaker": None,
            "segmentType": "stable_turn",
        },
    ]
    _write_template(templates / "100_1.jsonl", rows)
    store = GoldLabelStore(gold_dir=gold, repo_root=repo, labeler_id="tester")
    return store, repo, gold, audio_rel


def test_valid_a_and_b_labels(gold_env):
    store, *_ = gold_env
    v = store.save_label(index=0, gold_speaker="A", advance=False)
    assert v["currentLabel"] == "A"
    assert is_score_label("A")
    v = store.save_label(index=1, gold_speaker="B", advance=False)
    assert v["currentLabel"] == "B"
    assert store.progress_summary()["A"] == 1
    assert store.progress_summary()["B"] == 1


def test_overlap_unclear_skip_excluded(gold_env):
    store, *_ = gold_env
    store.save_label(index=0, gold_speaker="OVERLAP", advance=False)
    store.save_label(index=1, gold_speaker="UNCLEAR", advance=False)
    store.save_label(index=2, gold_speaker="SKIP", advance=False)
    s = store.progress_summary()
    assert s["overlap"] == 1 and s["unclear"] == 1 and s["skipped"] == 1
    assert s["gold_ab_labeled"] == 0
    assert is_excluded_label("OVERLAP")
    exported = store.export()
    assert exported["calls_count"] == 0
    assert exported["excluded_count"] == 3
    calls = (store.gold_dir / "calls.jsonl").read_text(encoding="utf-8").strip()
    assert calls == ""
    excl = (store.gold_dir / "excluded.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(excl) == 3


def test_resume_and_overwrite(gold_env):
    store, *_ = gold_env
    store.save_label(index=0, gold_speaker="A", advance=True)
    assert store.state["currentIndex"] == 1
    # overwrite
    store.save_label(index=0, gold_speaker="B", advance=False)
    assert store.state["labels"][store.segments[0]["segmentId"]]["goldSpeaker"] == "B"
    # reload from disk
    store2 = GoldLabelStore(gold_dir=store.gold_dir, repo_root=store.repo_root, labeler_id="tester")
    assert store2.state["labels"][store.segments[0]["segmentId"]]["goldSpeaker"] == "B"
    assert store2.next_unlabeled()["index"] in {1, 2}


def test_predictions_hidden_until_labeled(gold_env):
    store, *_ = gold_env
    view = store.get_view(0)
    assert view["predictions"] is None
    store.save_label(index=0, gold_speaker="A", advance=False)
    view2 = store.get_view(0)
    assert view2["predictions"]["assemblyAiSpeaker"] == "A"


def test_reference_set(gold_env):
    store, *_ = gold_env
    store.set_reference(speaker="A", index=0)
    store.set_reference(speaker="B", index=2)
    view = store.get_view(1)
    assert view["references"]["A"]["startMs"] == 1000
    assert view["references"]["B"]["startMs"] == 4000


def test_invalid_timestamp_and_missing_audio(tmp_path: Path):
    repo = tmp_path / "repo"
    gold = tmp_path / "gold"
    templates = gold / "templates"
    audio_rel = "backend/data/fc-recordings/missing.wav"
    rows = [
        {
            "callId": "9",
            "recordingId": "9",
            "audioPath": audio_rel,
            "startMs": 5000,
            "endMs": 1000,
            "text": "x",
            "assemblyAiSpeaker": "A",
            "goldSpeaker": None,
            "segmentType": "stable_turn",
        }
    ]
    _write_template(templates / "bad.jsonl", rows)
    store = GoldLabelStore(gold_dir=gold, repo_root=repo)
    result = validate_store(store)
    assert result["ok"] is False
    joined = " ".join(result["errors"])
    assert "startMs >= endMs" in joined
    assert "audioPath missing" in joined


def test_duplicate_segment(tmp_path: Path):
    repo = tmp_path / "repo"
    audio_rel = "a.wav"
    _write_wav(repo / audio_rel, duration_sec=3)
    gold = tmp_path / "gold"
    row = {
        "callId": "1",
        "recordingId": "1",
        "audioPath": audio_rel,
        "startMs": 0,
        "endMs": 500,
        "text": "x",
        "assemblyAiSpeaker": "A",
        "goldSpeaker": None,
        "segmentType": "stable_turn",
    }
    _write_template(gold / "templates" / "dup.jsonl", [row, row])
    store = GoldLabelStore(gold_dir=gold, repo_root=repo)
    # store keeps both rows but same segmentId — validation catches duplicates
    result = validate_store(store)
    assert any("duplicate segmentId" in e for e in result["errors"])


def test_calls_jsonl_export_ab_only(gold_env):
    store, *_ = gold_env
    store.save_label(index=0, gold_speaker="A", advance=False)
    store.save_label(index=1, gold_speaker="OVERLAP", advance=False)
    store.save_label(index=2, gold_speaker="B", advance=False)
    store.export()
    calls_path = store.gold_dir / "calls.jsonl"
    rows = [json.loads(l) for l in calls_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(rows) == 2
    assert {r["goldSpeaker"] for r in rows} == {"A", "B"}
    assert all("assemblyAiSpeaker" in r for r in rows)
    assert all(r["labelerId"] == "tester" for r in rows)


def test_clip_wav_respects_pad_and_bounds(gold_env):
    store, repo, gold, audio_rel = gold_env
    path = repo / audio_rel
    data = clip_wav_bytes(path, start_ms=0, end_ms=500, pad_ms=2000)
    assert data[:4] == b"RIFF"
    # pad beyond start clamps to 0
    data2 = clip_wav_bytes(path, start_ms=100, end_ms=200, pad_ms=5000)
    assert len(data2) > 44


def test_segment_id_stable():
    assert segment_id("1", "2", 3, 4) == "1|2|3|4"


def test_invalid_label_rejected(gold_env):
    store, *_ = gold_env
    with pytest.raises(ValueError):
        store.save_label(index=0, gold_speaker="AGENT", advance=False)
