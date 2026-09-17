"""Compare two transcript texts for agreement (WER, similarity, critical tokens)."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any

_NEGATION_RE = re.compile(
    r"\b(not|never|no|don't|dont|didn't|didnt|can't|cant|won't|wont|isn't|isnt|aren't|arent)\b",
    re.IGNORECASE,
)
_NUMBER_RE = re.compile(r"[\d$€£₹%,.]+")


def _normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"[^\w\s$€£₹%]", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


def _tokenize(text: str) -> list[str]:
    return _normalize_text(text).split()


def _similarity_ratio(a: str, b: str) -> float:
    ta, tb = _tokenize(a), _tokenize(b)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    # Token-set Jaccard-style overlap
    set_a, set_b = set(ta), set(tb)
    union = set_a | set_b
    if not union:
        return 1.0
    return len(set_a & set_b) / len(union)


def _wer(a: str, b: str) -> float:
    try:
        import jiwer

        return float(jiwer.wer(_normalize_text(a), _normalize_text(b)))
    except Exception:
        ta, tb = _tokenize(a), _tokenize(b)
        if not ta and not tb:
            return 0.0
        if not ta or not tb:
            return 1.0
        # Rough edit distance proxy
        common = len(set(ta) & set(tb))
        return 1.0 - (common / max(len(set(ta)), len(set(tb)), 1))


def _critical_mismatches(text_a: str, text_b: str) -> list[dict[str, Any]]:
    """Flag negation or number presence mismatches between normalized texts."""
    mismatches: list[dict[str, Any]] = []
    na, nb = _normalize_text(text_a), _normalize_text(text_b)

    neg_a = set(_NEGATION_RE.findall(na))
    neg_b = set(_NEGATION_RE.findall(nb))
    if neg_a != neg_b:
        mismatches.append(
            {
                "type": "negation",
                "detail": f"negations differ: {sorted(neg_a)} vs {sorted(neg_b)}",
            }
        )

    nums_a = set(_NUMBER_RE.findall(na))
    nums_b = set(_NUMBER_RE.findall(nb))
    if nums_a != nums_b:
        mismatches.append(
            {
                "type": "number",
                "detail": f"numeric tokens differ: {sorted(nums_a)} vs {sorted(nums_b)}",
            }
        )
    return mismatches


@dataclass
class CompareResult:
    wer: float
    similarity: float
    auto_accept: bool
    critical_mismatches: list[dict[str, Any]] = field(default_factory=list)
    threshold_wer_max: float = 0.12
    threshold_similarity_min: float = 0.88

    def to_dict(self) -> dict[str, Any]:
        return {
            "wer": round(self.wer, 4),
            "similarity": round(self.similarity, 4),
            "auto_accept": self.auto_accept,
            "threshold_wer_max": self.threshold_wer_max,
            "threshold_similarity_min": self.threshold_similarity_min,
            "critical_mismatches": self.critical_mismatches,
            "mismatch_spans": self.critical_mismatches,
        }


def compare_transcripts(text_a: str, text_b: str) -> CompareResult:
    wer_max = float(os.getenv("TRANSCRIPT_AGREE_WER_MAX", "0.12"))
    sim_min = float(os.getenv("TRANSCRIPT_AGREE_MIN_SIMILARITY", "0.88"))

    wer = _wer(text_a, text_b)
    similarity = _similarity_ratio(text_a, text_b)
    critical = _critical_mismatches(text_a, text_b)

    auto_accept = (
        wer <= wer_max
        and similarity >= sim_min
        and len(critical) == 0
    )

    return CompareResult(
        wer=wer,
        similarity=similarity,
        auto_accept=auto_accept,
        critical_mismatches=critical,
        threshold_wer_max=wer_max,
        threshold_similarity_min=sim_min,
    )
