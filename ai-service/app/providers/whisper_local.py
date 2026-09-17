"""Local faster-whisper transcription (pass B)."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from app.schemas import DiarizedUtterance


class WhisperLocalProvider:
    def __init__(self) -> None:
        self.model_name = os.getenv("WHISPER_MODEL", "small.en")
        self.device = os.getenv("WHISPER_DEVICE", "cpu")
        self.compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

    @lru_cache(maxsize=2)
    def _model(self) -> Any:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "faster-whisper is not installed. pip install faster-whisper in the AI venv."
            ) from exc
        return WhisperModel(self.model_name, device=self.device, compute_type=self.compute_type)

    def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
    ) -> tuple[list[DiarizedUtterance], str, float]:
        model = self._model()
        segments, info = model.transcribe(
            audio_path,
            language=language or None,
            word_timestamps=True,
            vad_filter=True,
        )
        utterances: list[DiarizedUtterance] = []
        confidences: list[float] = []
        for segment in segments:
            text = (segment.text or "").strip()
            if not text:
                continue
            avg_prob = 0.0
            if segment.words:
                probs = [float(w.probability) for w in segment.words if w.probability is not None]
                if probs:
                    avg_prob = sum(probs) / len(probs)
                    confidences.extend(probs)
            utterances.append(
                DiarizedUtterance(
                    speaker="W",
                    start=float(segment.start),
                    end=float(segment.end),
                    text=text,
                    confidence=avg_prob if avg_prob > 0 else None,
                )
            )
        lang = str(getattr(info, "language", None) or language or "unknown")
        duration = float(utterances[-1].end) if utterances else 0.0
        return utterances, lang, duration
