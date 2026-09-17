"""Shared constants and helpers for physical A/B gold labeling."""

from __future__ import annotations

from typing import Any, Optional

# Labels that count toward evaluation accuracy metrics.
SCORE_LABELS = frozenset({"A", "B"})

# Human labels that are valid but excluded from A/B accuracy metrics.
EXCLUDED_LABELS = frozenset({"OVERLAP", "UNCLEAR", "SKIP"})

VALID_LABELS = SCORE_LABELS | EXCLUDED_LABELS


def normalize_label(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    value = str(raw).strip().upper()
    if not value or value in {"NULL", "NONE", "NEEDS_LABEL"}:
        return None
    return value


def is_score_label(raw: Optional[str]) -> bool:
    return normalize_label(raw) in SCORE_LABELS


def is_excluded_label(raw: Optional[str]) -> bool:
    return normalize_label(raw) in EXCLUDED_LABELS


def is_valid_label(raw: Optional[str]) -> bool:
    return normalize_label(raw) in VALID_LABELS


def segment_id(
    call_id: str,
    recording_id: str,
    start_ms: int,
    end_ms: int,
) -> str:
    return f"{call_id}|{recording_id}|{start_ms}|{end_ms}"


def segment_id_from_row(row: dict[str, Any]) -> str:
    return segment_id(
        str(row["callId"]),
        str(row.get("recordingId") or ""),
        int(row["startMs"]),
        int(row["endMs"]),
    )


def format_ts_ms(ms: int) -> str:
    total_ms = max(0, int(ms))
    minutes, rem = divmod(total_ms, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{minutes:02d}:{seconds:02d}.{millis:03d}"
