"""Validate gold templates + progress labels before evaluation."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from .audio_clip import audio_duration_ms
from .schema import VALID_LABELS, normalize_label, segment_id_from_row
from .store import GoldLabelStore, resolve_audio_path


def validate_store(store: GoldLabelStore) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    seen_ids: Counter[str] = Counter()
    duration_cache: dict[str, float] = {}

    for seg in store.segments:
        sid = seg["segmentId"]
        seen_ids[sid] += 1
        if not seg.get("callId"):
            errors.append(f"{sid}: missing callId")
        if seg["startMs"] >= seg["endMs"]:
            errors.append(f"{sid}: startMs >= endMs ({seg['startMs']} >= {seg['endMs']})")
        audio = resolve_audio_path(seg["audioPath"], repo_root=store.repo_root)
        if not audio.is_file():
            errors.append(f"{sid}: audioPath missing: {audio}")
            continue
        key = str(audio)
        if key not in duration_cache:
            try:
                duration_cache[key] = audio_duration_ms(audio)
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{sid}: cannot read audio duration: {exc}")
                continue
        dur = duration_cache[key]
        if seg["startMs"] < 0 or seg["endMs"] > dur + 50:  # 50ms tolerance
            errors.append(
                f"{sid}: timestamps outside recording "
                f"({seg['startMs']}-{seg['endMs']} ms vs duration {dur:.0f} ms)"
            )

    for sid, n in seen_ids.items():
        if n > 1:
            errors.append(f"duplicate segmentId {sid} appears {n} times")

    for sid, rec in store.state.get("labels", {}).items():
        label = normalize_label(rec.get("goldSpeaker"))
        if label not in VALID_LABELS:
            errors.append(f"label {sid}: invalid goldSpeaker {rec.get('goldSpeaker')!r}")
        if sid not in store._by_id:  # noqa: SLF001 — intentional
            warnings.append(f"label {sid}: no matching template segment")
        second = normalize_label(rec.get("secondLabel")) if rec.get("secondLabel") else None
        if second is not None and second not in VALID_LABELS:
            errors.append(f"label {sid}: invalid secondLabel {rec.get('secondLabel')!r}")

    # Reference consistency: refs must point at real segments in the same call
    for ck, refs in (store.state.get("references") or {}).items():
        for sp, ref in (refs or {}).items():
            if sp not in {"A", "B"}:
                errors.append(f"reference {ck}: invalid speaker {sp}")
                continue
            rsid = (ref or {}).get("segmentId")
            if rsid and rsid not in store._by_id:  # noqa: SLF001
                errors.append(f"reference {ck}/{sp}: unknown segmentId {rsid}")

    summary = store.progress_summary()
    return {
        "ok": len(errors) == 0,
        "errors": errors,
        "warnings": warnings,
        "summary": summary,
    }
