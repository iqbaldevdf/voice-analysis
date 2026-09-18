"""Unit tests for SPEAKER_EMBEDDING_BACKEND selection (no heavy model load)."""

from __future__ import annotations

import numpy as np

from app.pipeline import speaker_embeddings as se


def test_embedding_backend_default(monkeypatch):
    monkeypatch.delenv("SPEAKER_EMBEDDING_BACKEND", raising=False)
    assert se.embedding_backend() == "speechbrain"


def test_embedding_backend_nemo_aliases(monkeypatch):
    for value in ("nemo", "NVIDIA", "nemo_ecapa", "ngc"):
        monkeypatch.setenv("SPEAKER_EMBEDDING_BACKEND", value)
        assert se.embedding_backend() == "nemo"


def test_ecapa_available_nemo_without_install(monkeypatch):
    monkeypatch.setenv("SPEAKER_EMBEDDING_BACKEND", "nemo")
    monkeypatch.setattr(se, "nemo_available", lambda: False)
    assert se.ecapa_available() is False
    monkeypatch.setattr(se, "nemo_available", lambda: True)
    assert se.ecapa_available() is True


def test_l2_normalize_helper():
    v = np.array([3.0, 4.0], dtype=np.float32)
    out = se._l2_normalize(v)
    assert abs(float(np.linalg.norm(out)) - 1.0) < 1e-5
