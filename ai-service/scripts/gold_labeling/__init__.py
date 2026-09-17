"""Gold labeling library (developer / offline only). Avoids stdlib `eval` package name."""

from __future__ import annotations

from .schema import EXCLUDED_LABELS, SCORE_LABELS, VALID_LABELS, segment_id
from .store import GoldLabelStore

__all__ = [
    "EXCLUDED_LABELS",
    "SCORE_LABELS",
    "VALID_LABELS",
    "GoldLabelStore",
    "segment_id",
]
