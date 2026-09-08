from __future__ import annotations

import json
import os
from typing import TypedDict


class PerformanceWeights(TypedDict):
    communicationEffectiveness: float
    responseRelevance: float
    activeListening: float
    turnTaking: float
    engagement: float
    conversationBalance: float
    efficiency: float


DEFAULT_WEIGHTS: PerformanceWeights = {
    "communicationEffectiveness": 0.20,
    "responseRelevance": 0.20,
    "activeListening": 0.15,
    "turnTaking": 0.15,
    "engagement": 0.10,
    "conversationBalance": 0.10,
    "efficiency": 0.10,
}

SHORT_TURN_SEC = 2.0
LONG_MONOLOGUE_SEC = 20.0
ANALYSIS_VERSION = "1"


def load_weights() -> PerformanceWeights:
    raw = (os.getenv("PERF_WEIGHTS_JSON") or "").strip()
    weights: dict[str, float] = dict(DEFAULT_WEIGHTS)
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, dict):
                for key in DEFAULT_WEIGHTS:
                    if key in parsed:
                        weights[key] = float(parsed[key])
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    total = sum(weights.values()) or 1.0
    return {key: value / total for key, value in weights.items()}  # type: ignore[return-value]


def weighted_overall(scores: dict[str, float], weights: PerformanceWeights | None = None) -> float:
    chosen = weights or load_weights()
    total = 0.0
    for key, weight in chosen.items():
        total += float(scores.get(key, 0.0)) * weight
    return round(max(0.0, min(100.0, total)), 1)
