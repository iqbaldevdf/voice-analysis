"""Load templates, persist labels, export calls.jsonl / excluded.jsonl."""

from __future__ import annotations

import json
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from .schema import (
    EXCLUDED_LABELS,
    SCORE_LABELS,
    VALID_LABELS,
    is_score_label,
    normalize_label,
    segment_id_from_row,
)

AI_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = AI_ROOT.parent
GOLD_DIR = AI_ROOT / "eval" / "gold"
TEMPLATES_DIR = GOLD_DIR / "templates"
PROGRESS_DIR = GOLD_DIR / "progress"
PROGRESS_PATH = PROGRESS_DIR / "progress.json"
CALLS_JSONL = GOLD_DIR / "calls.jsonl"
EXCLUDED_JSONL = GOLD_DIR / "excluded.jsonl"

# Ready-for-evaluation criteria (documented in README).
MIN_AB_LABELS = 50
MIN_CALLS_WITH_AB = 5
MIN_AB_PER_READY_CALL = 3


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def resolve_audio_path(audio_path: str | Path, *, repo_root: Path = REPO_ROOT) -> Path:
    path = Path(audio_path)
    if not path.is_absolute():
        path = (repo_root / path).resolve()
    return path


class GoldLabelStore:
    """Thread-safe progress store for the offline labeling UI."""

    def __init__(
        self,
        *,
        gold_dir: Path | None = None,
        templates_dir: Path | None = None,
        progress_path: Path | None = None,
        repo_root: Path | None = None,
        labeler_id: str = "default",
    ) -> None:
        self.gold_dir = gold_dir or GOLD_DIR
        self.templates_dir = templates_dir or (self.gold_dir / "templates")
        self.progress_path = progress_path or (self.gold_dir / "progress" / "progress.json")
        self.repo_root = repo_root or REPO_ROOT
        self.labeler_id = labeler_id or "default"
        self._lock = threading.Lock()
        self.segments: list[dict[str, Any]] = []
        self._by_id: dict[str, dict[str, Any]] = {}
        self.state: dict[str, Any] = self._empty_state()
        self.reload()

    def _empty_state(self) -> dict[str, Any]:
        return {
            "version": 1,
            "labelerId": self.labeler_id,
            "currentIndex": 0,
            "callFilter": None,
            "references": {},  # callKey -> {A: {startMs,endMs,segmentId}, B: {...}}
            "labels": {},  # segmentId -> label record
            "updatedAt": None,
        }

    def reload(self) -> None:
        with self._lock:
            self.segments = self._load_templates()
            self._by_id = {segment_id_from_row(s): s for s in self.segments}
            loaded = self._load_progress_unlocked()
            self.state = loaded
            if not self.state.get("labelerId"):
                self.state["labelerId"] = self.labeler_id
            # Clamp index
            n = len(self.segments)
            idx = int(self.state.get("currentIndex") or 0)
            self.state["currentIndex"] = max(0, min(idx, max(0, n - 1)))

    def _load_templates(self) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        if not self.templates_dir.is_dir():
            return rows
        for path in sorted(self.templates_dir.glob("*.jsonl")):
            for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                obj = json.loads(line)
                obj["_templateFile"] = path.name
                obj["_templateLine"] = line_no
                obj["callId"] = str(obj["callId"])
                obj["recordingId"] = str(obj.get("recordingId") or "")
                obj["startMs"] = int(obj["startMs"])
                obj["endMs"] = int(obj["endMs"])
                obj["audioPath"] = str(obj["audioPath"])
                obj["segmentType"] = str(obj.get("segmentType") or "stable_turn")
                obj["text"] = str(obj.get("text") or "")
                # Keep assemblyAiSpeaker in store for post-label reveal only.
                obj["assemblyAiSpeaker"] = str(obj.get("assemblyAiSpeaker") or "").strip().upper()
                sid = segment_id_from_row(obj)
                obj["segmentId"] = sid
                rows.append(obj)
        rows.sort(key=lambda r: (r["callId"], r["recordingId"], r["startMs"], r["endMs"]))
        return rows

    def _load_progress_unlocked(self) -> dict[str, Any]:
        if not self.progress_path.is_file():
            return self._empty_state()
        raw = json.loads(self.progress_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            return self._empty_state()
        state = self._empty_state()
        state.update({k: raw.get(k, state[k]) for k in state})
        state["labels"] = dict(raw.get("labels") or {})
        state["references"] = dict(raw.get("references") or {})
        return state

    def _save_unlocked(self) -> None:
        self.progress_path.parent.mkdir(parents=True, exist_ok=True)
        self.state["updatedAt"] = _utc_now()
        self.state["labelerId"] = self.labeler_id
        tmp = self.progress_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.state, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        tmp.replace(self.progress_path)

    def save(self) -> None:
        with self._lock:
            self._save_unlocked()

    @staticmethod
    def call_key(call_id: str, recording_id: str) -> str:
        return f"{call_id}_{recording_id}"

    def filtered_indices(self, call_filter: str | None = None) -> list[int]:
        filt = call_filter if call_filter is not None else self.state.get("callFilter")
        if not filt:
            return list(range(len(self.segments)))
        filt = str(filt)
        out: list[int] = []
        for i, seg in enumerate(self.segments):
            key = self.call_key(seg["callId"], seg["recordingId"])
            if filt in {seg["callId"], key, f"{seg['callId']}_{seg['recordingId']}"}:
                out.append(i)
        return out

    def progress_summary(self) -> dict[str, Any]:
        with self._lock:
            return self._summary_unlocked()

    def _summary_unlocked(self) -> dict[str, Any]:
        counts = {"A": 0, "B": 0, "OVERLAP": 0, "UNCLEAR": 0, "SKIP": 0}
        calls_ab: dict[str, int] = {}
        for seg in self.segments:
            sid = seg["segmentId"]
            rec = self.state["labels"].get(sid)
            if not rec:
                continue
            label = normalize_label(rec.get("goldSpeaker"))
            if label in counts:
                counts[label] += 1
            if label in SCORE_LABELS:
                ck = self.call_key(seg["callId"], seg["recordingId"])
                calls_ab[ck] = calls_ab.get(ck, 0) + 1
        total = len(self.segments)
        labeled = sum(counts.values())
        remaining = total - labeled
        ab = counts["A"] + counts["B"]
        calls_ready = sum(1 for n in calls_ab.values() if n >= MIN_AB_PER_READY_CALL)
        ready = (
            ab >= MIN_AB_LABELS
            and calls_ready >= MIN_CALLS_WITH_AB
        )
        return {
            "calls": len({self.call_key(s["callId"], s["recordingId"]) for s in self.segments}),
            "segments": total,
            "gold_ab_labeled": ab,
            "A": counts["A"],
            "B": counts["B"],
            "overlap": counts["OVERLAP"],
            "unclear": counts["UNCLEAR"],
            "skipped": counts["SKIP"],
            "remaining": remaining,
            "calls_with_ab": len(calls_ab),
            "calls_meeting_min_ab": calls_ready,
            "ready_for_evaluation": ready,
            "ready_criteria": {
                "min_ab_labels": MIN_AB_LABELS,
                "min_calls_with_ab": MIN_CALLS_WITH_AB,
                "min_ab_per_ready_call": MIN_AB_PER_READY_CALL,
            },
            "labelerId": self.state.get("labelerId") or self.labeler_id,
            "updatedAt": self.state.get("updatedAt"),
            "progress_path": str(self.progress_path),
        }

    def list_calls(self) -> list[dict[str, Any]]:
        with self._lock:
            by_call: dict[str, dict[str, Any]] = {}
            for i, seg in enumerate(self.segments):
                key = self.call_key(seg["callId"], seg["recordingId"])
                entry = by_call.setdefault(
                    key,
                    {
                        "callKey": key,
                        "callId": seg["callId"],
                        "recordingId": seg["recordingId"],
                        "segments": 0,
                        "labeled": 0,
                        "firstIndex": i,
                    },
                )
                entry["segments"] += 1
                if seg["segmentId"] in self.state["labels"]:
                    entry["labeled"] += 1
            return sorted(by_call.values(), key=lambda x: x["callKey"])

    def get_view(self, index: int | None = None, *, reveal_predictions: bool = False) -> dict[str, Any]:
        with self._lock:
            indices = self.filtered_indices()
            if not indices:
                return {"empty": True, "summary": self._summary_unlocked()}
            if index is None:
                index = int(self.state.get("currentIndex") or 0)
            if index not in indices:
                # snap to nearest in filter
                index = indices[0]
                self.state["currentIndex"] = index
            seg = self.segments[index]
            sid = seg["segmentId"]
            label_rec = self.state["labels"].get(sid)
            labeled = bool(label_rec)
            show_pred = reveal_predictions or labeled
            pos_in_filter = indices.index(index) + 1
            ck = self.call_key(seg["callId"], seg["recordingId"])
            refs = self.state["references"].get(ck) or {}
            audio = resolve_audio_path(seg["audioPath"], repo_root=self.repo_root)
            view = {
                "empty": False,
                "index": index,
                "position": pos_in_filter,
                "filterTotal": len(indices),
                "globalTotal": len(self.segments),
                "segmentId": sid,
                "callId": seg["callId"],
                "recordingId": seg["recordingId"],
                "callKey": ck,
                "startMs": seg["startMs"],
                "endMs": seg["endMs"],
                "durationMs": seg["endMs"] - seg["startMs"],
                "segmentType": seg["segmentType"],
                "text": seg["text"],
                "audioPath": seg["audioPath"],
                "audioExists": audio.is_file(),
                "currentLabel": (label_rec or {}).get("goldSpeaker"),
                "labelRecord": label_rec,
                "references": {
                    "A": refs.get("A"),
                    "B": refs.get("B"),
                },
                "summary": self._summary_unlocked(),
                "callFilter": self.state.get("callFilter"),
                "calls": [
                    {
                        "callKey": self.call_key(s["callId"], s["recordingId"]),
                        "callId": s["callId"],
                        "recordingId": s["recordingId"],
                    }
                    for s in self.segments
                ],
            }
            # Deduplicate calls for UI dropdown
            seen: set[str] = set()
            call_list: list[dict[str, Any]] = []
            for c in view["calls"]:
                if c["callKey"] in seen:
                    continue
                seen.add(c["callKey"])
                call_list.append(c)
            view["calls"] = call_list
            if show_pred:
                view["predictions"] = {
                    "assemblyAiSpeaker": seg.get("assemblyAiSpeaker"),
                }
            else:
                view["predictions"] = None
            return view

    def set_call_filter(self, call_filter: str | None) -> dict[str, Any]:
        with self._lock:
            self.state["callFilter"] = call_filter or None
            indices = self.filtered_indices()
            if indices and self.state["currentIndex"] not in indices:
                self.state["currentIndex"] = indices[0]
            self._save_unlocked()
            return {"callFilter": self.state["callFilter"], "indices": indices}

    def jump(self, index: int) -> dict[str, Any]:
        with self._lock:
            if not self.segments:
                return self.get_view()
            index = max(0, min(int(index), len(self.segments) - 1))
            self.state["currentIndex"] = index
            self._save_unlocked()
        return self.get_view(index)

    def jump_call(self, call_key_or_id: str) -> dict[str, Any]:
        with self._lock:
            self.state["callFilter"] = call_key_or_id
            indices = self.filtered_indices()
            if indices:
                self.state["currentIndex"] = indices[0]
            self._save_unlocked()
        return self.get_view()

    def next_unlabeled(self) -> dict[str, Any]:
        with self._lock:
            indices = self.filtered_indices()
            if not indices:
                return {"empty": True, "summary": self._summary_unlocked()}
            start = int(self.state.get("currentIndex") or 0)
            if start in indices:
                pos = indices.index(start)
                ordered = indices[pos + 1 :] + indices[: pos + 1]
            else:
                ordered = indices
            for i in ordered:
                if self.segments[i]["segmentId"] not in self.state["labels"]:
                    self.state["currentIndex"] = i
                    self._save_unlocked()
                    break
            else:
                self.state["currentIndex"] = indices[0]
                self._save_unlocked()
        return self.get_view()

    def save_label(
        self,
        *,
        segment_id: str | None = None,
        index: int | None = None,
        gold_speaker: str,
        labeler_id: str | None = None,
        notes: str | None = None,
        second_label: str | None = None,
        advance: bool = True,
    ) -> dict[str, Any]:
        label = normalize_label(gold_speaker)
        if label not in VALID_LABELS:
            raise ValueError(f"Invalid goldSpeaker {gold_speaker!r}; expected one of {sorted(VALID_LABELS)}")
        second = normalize_label(second_label) if second_label else None
        if second is not None and second not in VALID_LABELS:
            raise ValueError(f"Invalid secondLabel {second_label!r}")

        with self._lock:
            if segment_id is None:
                if index is None:
                    index = int(self.state.get("currentIndex") or 0)
                segment_id = self.segments[index]["segmentId"]
            if segment_id not in self._by_id:
                raise KeyError(f"Unknown segmentId: {segment_id}")
            seg = self._by_id[segment_id]
            index = next(i for i, s in enumerate(self.segments) if s["segmentId"] == segment_id)
            lid = labeler_id or self.labeler_id
            prev = self.state["labels"].get(segment_id) or {}
            rec = {
                "segmentId": segment_id,
                "callId": seg["callId"],
                "recordingId": seg["recordingId"],
                "startMs": seg["startMs"],
                "endMs": seg["endMs"],
                "goldSpeaker": label,
                "labelerId": lid,
                "labeledAt": _utc_now(),
                "notes": notes if notes is not None else prev.get("notes"),
                "secondLabel": second if second is not None else prev.get("secondLabel"),
            }
            self.state["labels"][segment_id] = rec
            self.state["currentIndex"] = index
            if advance:
                indices = self.filtered_indices()
                if index in indices:
                    pos = indices.index(index)
                    if pos + 1 < len(indices):
                        self.state["currentIndex"] = indices[pos + 1]
            self._save_unlocked()
            self._export_unlocked()
            out_index = int(self.state["currentIndex"])
        return self.get_view(out_index, reveal_predictions=True)

    def set_reference(self, *, speaker: str, segment_id: str | None = None, index: int | None = None) -> dict[str, Any]:
        sp = normalize_label(speaker)
        if sp not in SCORE_LABELS:
            raise ValueError("Reference speaker must be A or B")
        with self._lock:
            if segment_id is None:
                if index is None:
                    index = int(self.state.get("currentIndex") or 0)
                segment_id = self.segments[index]["segmentId"]
            seg = self._by_id[segment_id]
            ck = self.call_key(seg["callId"], seg["recordingId"])
            refs = dict(self.state["references"].get(ck) or {})
            refs[sp] = {
                "segmentId": segment_id,
                "startMs": seg["startMs"],
                "endMs": seg["endMs"],
                "text": seg.get("text") or "",
                "setAt": _utc_now(),
            }
            self.state["references"][ck] = refs
            self._save_unlocked()
        return self.get_view()

    def clear_reference(self, *, call_key: str, speaker: str) -> dict[str, Any]:
        sp = normalize_label(speaker)
        with self._lock:
            refs = dict(self.state["references"].get(call_key) or {})
            if sp in refs:
                del refs[sp]
            self.state["references"][call_key] = refs
            self._save_unlocked()
        return self.get_view()

    def export(self) -> dict[str, Any]:
        with self._lock:
            return self._export_unlocked()

    def _export_unlocked(self) -> dict[str, Any]:
        calls_rows: list[dict[str, Any]] = []
        excluded_rows: list[dict[str, Any]] = []
        for seg in self.segments:
            sid = seg["segmentId"]
            rec = self.state["labels"].get(sid)
            if not rec:
                continue
            label = normalize_label(rec.get("goldSpeaker"))
            row = {
                "callId": seg["callId"],
                "recordingId": seg["recordingId"],
                "audioPath": seg["audioPath"],
                "startMs": seg["startMs"],
                "endMs": seg["endMs"],
                "text": seg.get("text") or "",
                "assemblyAiSpeaker": seg.get("assemblyAiSpeaker"),
                "goldSpeaker": label,
                "segmentType": seg.get("segmentType") or "stable_turn",
                "notes": rec.get("notes") or "",
                "labelerId": rec.get("labelerId") or self.labeler_id,
                "labeledAt": rec.get("labeledAt"),
                "segmentId": sid,
            }
            if rec.get("secondLabel"):
                row["secondLabel"] = rec["secondLabel"]
            if label in SCORE_LABELS:
                calls_rows.append(row)
            elif label in EXCLUDED_LABELS:
                excluded_rows.append(row)

        calls_path = self.gold_dir / "calls.jsonl"
        excluded_path = self.gold_dir / "excluded.jsonl"
        self._write_jsonl(calls_path, calls_rows)
        self._write_jsonl(excluded_path, excluded_rows)
        return {
            "calls_jsonl": str(calls_path),
            "excluded_jsonl": str(excluded_path),
            "calls_count": len(calls_rows),
            "excluded_count": len(excluded_rows),
        }

    @staticmethod
    def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps(r, ensure_ascii=False) for r in rows]
        path.write_text(("\n".join(lines) + ("\n" if lines else "")), encoding="utf-8")

    def get_segment(self, index: int) -> dict[str, Any]:
        return deepcopy(self.segments[index])
