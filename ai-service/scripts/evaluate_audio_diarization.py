"""
Offline gold evaluation for physical A/B diarization (developer only).

Compares:
  A) AssemblyAI original labels
  B) Phase 2 — island ECAPA validation (boundary off)
  C) Phase 3 — robust profiles + islands + boundary (when words available)

Does NOT score Agent/Customer role mapping.
Does NOT invent gold labels. Rows with goldSpeaker=null are skipped for metrics.

Usage (from ai-service/):
  set AUDIO_SPEAKER_VALIDATION=true   # process env for this shell only
  python scripts/evaluate_audio_diarization.py \\
    --gold eval/gold/calls.jsonl \\
    --report eval/DIARIZATION_EVAL_REPORT.md

Or evaluate templates after labeling:
  python scripts/evaluate_audio_diarization.py --gold eval/gold/templates/9002261_5348624.jsonl

Production default AUDIO_SPEAKER_VALIDATION=false must remain unchanged in .env.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
sys.path.insert(0, str(ROOT))

from app.pipeline.audio_speaker_validation import (  # noqa: E402
    ValidationConfig,
    validate_speakers_audio,
)
from app.schemas import DiarizedUtterance, DiarizedWord  # noqa: E402


SegmentType = str


@dataclass
class GoldSegment:
    call_id: str
    recording_id: str
    audio_path: Path
    start_ms: int
    end_ms: int
    text: str
    aai_speaker: str
    gold_speaker: Optional[str]
    segment_type: str
    notes: str = ""

    @property
    def start_sec(self) -> float:
        return self.start_ms / 1000.0

    @property
    def end_sec(self) -> float:
        return self.end_ms / 1000.0

    @property
    def labeled(self) -> bool:
        return self.gold_speaker in {"A", "B", "a", "b"}


@dataclass
class EvalRow:
    segment: GoldSegment
    phase2_speaker: str
    phase3_speaker: str
    phase2_status: str
    phase3_status: str
    phase3_reason: str
    similarity_to_a: Optional[float]
    similarity_to_b: Optional[float]
    margin: Optional[float]
    outcome: str  # taxonomy below


@dataclass
class Metrics:
    n: int = 0
    aai_correct: int = 0
    phase2_correct: int = 0
    phase3_correct: int = 0
    correct_correction: int = 0
    false_correction: int = 0
    missed_correction: int = 0
    confirmed_correct: int = 0
    uncertain_correct_original: int = 0
    uncertain_wrong_original: int = 0
    by_type: dict[str, dict[str, int]] = field(default_factory=lambda: defaultdict(lambda: defaultdict(int)))


def load_gold(path: Path) -> list[GoldSegment]:
    rows: list[GoldSegment] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        obj = json.loads(line)
        audio = Path(obj["audioPath"])
        if not audio.is_absolute():
            audio = (REPO / audio).resolve()
        gold = obj.get("goldSpeaker")
        if isinstance(gold, str):
            gold = gold.strip().upper() or None
        # Only physical A/B count for metrics. OVERLAP/UNCLEAR/SKIP are excluded.
        if gold not in {"A", "B"}:
            gold = None
        rows.append(
            GoldSegment(
                call_id=str(obj["callId"]),
                recording_id=str(obj.get("recordingId") or ""),
                audio_path=audio,
                start_ms=int(obj["startMs"]),
                end_ms=int(obj["endMs"]),
                text=str(obj.get("text") or ""),
                aai_speaker=str(obj["assemblyAiSpeaker"]).strip().upper(),
                gold_speaker=gold,
                segment_type=str(obj.get("segmentType") or "stable_turn"),
                notes=str(obj.get("notes") or ""),
            )
        )
    return rows


def group_by_call(segments: list[GoldSegment]) -> dict[tuple[str, str], list[GoldSegment]]:
    out: dict[tuple[str, str], list[GoldSegment]] = defaultdict(list)
    for s in segments:
        out[(s.call_id, s.recording_id)].append(s)
    for key in out:
        out[key].sort(key=lambda x: x.start_ms)
    return out


def segments_to_utterances(segs: list[GoldSegment]) -> list[DiarizedUtterance]:
    return [
        DiarizedUtterance(
            speaker=s.aai_speaker,
            start=s.start_sec,
            end=s.end_sec,
            text=s.text or "x",
        )
        for s in segs
    ]


def synthetic_words_from_segments(segs: list[GoldSegment]) -> list[DiarizedWord]:
    """Approximate word stream for boundary path when gold is utterance-level."""
    words: list[DiarizedWord] = []
    for s in segs:
        tokens = (s.text or "x").split() or ["x"]
        dur = max(0.05, s.end_sec - s.start_sec)
        step = dur / len(tokens)
        for i, tok in enumerate(tokens):
            a = s.start_sec + i * step
            b = s.start_sec + (i + 1) * step
            words.append(DiarizedWord(speaker=s.aai_speaker, start=a, end=b, word=tok))
    return words


def speaker_at_time(units: list[DiarizedUtterance], t: float, default: str) -> tuple[str, Optional[Any]]:
    mid = t
    for u in units:
        if float(u.start) - 1e-3 <= mid <= float(u.end) + 1e-3:
            return u.speaker, u.speaker_validation
    # nearest
    best = None
    best_d = 1e9
    for u in units:
        d = abs(((u.start + u.end) / 2.0) - mid)
        if d < best_d:
            best_d = d
            best = u
    if best is None:
        return default, None
    return best.speaker, best.speaker_validation


def classify_outcome(
    *,
    gold: str,
    aai: str,
    phase3: str,
    status: str,
) -> str:
    aai_ok = aai == gold
    p3_ok = phase3 == gold
    changed = phase3 != aai

    if status in {"uncertain", "insufficient_audio"} and not changed:
        return "uncertain_correct_original" if aai_ok else "uncertain_wrong_original"
    if changed and (not aai_ok) and p3_ok:
        return "correct_correction"
    if changed and aai_ok and (not p3_ok):
        return "false_correction"
    if (not changed) and (not aai_ok) and (not p3_ok):
        return "missed_correction"
    if (not changed) and aai_ok and p3_ok:
        return "confirmed_correct"
    # rare: changed but still wrong, or changed from wrong to wrong
    if changed and not p3_ok:
        return "false_correction" if aai_ok else "missed_correction"
    return "confirmed_correct" if p3_ok else "missed_correction"


def run_call(
    segs: list[GoldSegment],
    *,
    use_synthetic_words: bool,
) -> tuple[list[DiarizedUtterance], list[DiarizedUtterance], Any, Any]:
    audio = segs[0].audio_path
    if not audio.is_file():
        raise FileNotFoundError(f"Missing audio: {audio}")

    utts = segments_to_utterances(segs)
    words = synthetic_words_from_segments(segs) if use_synthetic_words else []

    cfg2 = ValidationConfig(
        boundary_validation=False,
        long_turn_scan=False,
        long_turn_validation=False,
    )
    out2, _, summary2 = validate_speakers_audio(
        audio_path=str(audio),
        utterances=utts,
        words=[],
        cfg=cfg2,
        recording_id=f"{segs[0].call_id}_{segs[0].recording_id}",
    )

    cfg3 = ValidationConfig(
        boundary_validation=True,
        long_turn_scan=False,
        long_turn_validation=False,
    )
    out3, _, summary3 = validate_speakers_audio(
        audio_path=str(audio),
        utterances=list(utts),  # fresh AAI labels
        words=words,
        cfg=cfg3,
        recording_id=f"{segs[0].call_id}_{segs[0].recording_id}",
    )
    return out2, out3, summary2, summary3


def evaluate(
    gold_rows: list[GoldSegment],
    *,
    use_synthetic_words: bool,
) -> tuple[Metrics, list[EvalRow], dict[str, Any]]:
    labeled = [g for g in gold_rows if g.labeled]
    meta: dict[str, Any] = {
        "total_rows": len(gold_rows),
        "labeled_rows": len(labeled),
        "unlabeled_rows": len(gold_rows) - len(labeled),
        "calls_evaluated": 0,
        "ecapa_ran": False,
        "errors": [],
    }
    metrics = Metrics()
    rows: list[EvalRow] = []

    if not labeled:
        return metrics, rows, meta

    by_call = group_by_call(labeled)
    meta["calls_evaluated"] = len(by_call)

    for (_cid, _rid), segs in by_call.items():
        try:
            out2, out3, summary2, summary3 = run_call(segs, use_synthetic_words=use_synthetic_words)
            if summary3.method:
                meta["ecapa_ran"] = True
            meta.setdefault("summaries", []).append(
                {
                    "callId": segs[0].call_id,
                    "phase2": summary2.model_dump(),
                    "phase3": summary3.model_dump(),
                }
            )
        except Exception as exc:  # noqa: BLE001
            meta["errors"].append({"callId": segs[0].call_id, "error": str(exc)})
            continue

        for s in segs:
            gold = str(s.gold_speaker).upper()
            mid = (s.start_sec + s.end_sec) / 2.0
            p2, _ = speaker_at_time(out2, mid, s.aai_speaker)
            p3, meta3 = speaker_at_time(out3, mid, s.aai_speaker)
            status = "skipped"
            reason = ""
            sim_a = sim_b = margin = None
            if meta3 is not None:
                status = meta3.speaker_validation_status
                reason = meta3.speaker_validation_reason or ""
                sim_a = meta3.similarity_to_a
                sim_b = meta3.similarity_to_b
                margin = meta3.speaker_validation_margin

            outcome = classify_outcome(gold=gold, aai=s.aai_speaker, phase3=p3, status=status)
            row = EvalRow(
                segment=s,
                phase2_speaker=p2,
                phase3_speaker=p3,
                phase2_status="island_path",
                phase3_status=status,
                phase3_reason=reason,
                similarity_to_a=sim_a,
                similarity_to_b=sim_b,
                margin=margin,
                outcome=outcome,
            )
            rows.append(row)

            metrics.n += 1
            if s.aai_speaker == gold:
                metrics.aai_correct += 1
            if p2 == gold:
                metrics.phase2_correct += 1
            if p3 == gold:
                metrics.phase3_correct += 1

            attr = outcome
            setattr(metrics, attr, getattr(metrics, attr) + 1)
            metrics.by_type[s.segment_type]["n"] += 1
            metrics.by_type[s.segment_type][attr] += 1
            if s.aai_speaker == gold:
                metrics.by_type[s.segment_type]["aai_correct"] += 1
            if p3 == gold:
                metrics.by_type[s.segment_type]["phase3_correct"] += 1

    return metrics, rows, meta


def pct(num: int, den: int) -> str:
    if den <= 0:
        return "n/a"
    return f"{100.0 * num / den:.1f}%"


def write_report(
    path: Path,
    *,
    metrics: Metrics,
    rows: list[EvalRow],
    meta: dict[str, Any],
    gold_path: Path,
) -> None:
    lines: list[str] = []
    lines.append("# Diarization evaluation report")
    lines.append("")
    lines.append("Developer/offline only. Physical speakers A/B — not Agent/Customer.")
    lines.append("")
    lines.append(f"- Gold file: `{gold_path.as_posix()}`")
    lines.append(f"- Total rows in file: {meta['total_rows']}")
    lines.append(f"- Labeled rows used: {meta['labeled_rows']}")
    lines.append(f"- Unlabeled (skipped): {meta['unlabeled_rows']}")
    lines.append(f"- Calls evaluated: {meta['calls_evaluated']}")
    lines.append(f"- ECAPA executed: {meta.get('ecapa_ran')}")
    if meta.get("errors"):
        lines.append(f"- Call errors: {meta['errors']}")
    lines.append("")

    if metrics.n == 0:
        lines.append("## Status: WAITING FOR GOLD LABELS")
        lines.append("")
        lines.append("No rows with `goldSpeaker` set to `A` or `B` were found.")
        lines.append("Accuracy / false-correction metrics are **not valid** until manual labels exist.")
        lines.append("")
        lines.append("### What you must do before metrics are valid")
        lines.append("")
        lines.append("1. Open templates under `eval/gold/templates/` (~11 calls / ~184 segments scaffolded).")
        lines.append("2. Listen to each audio segment (do not infer from transcript semantics).")
        lines.append("3. Set `goldSpeaker` to the true **physical** speaker (`A` or `B`) — not Agent/Customer.")
        lines.append("4. Prefer labeling islands, short responses (Okay/Yes/No), interruptions, and stable turns.")
        lines.append("5. Append finished segments to `eval/gold/calls.jsonl` (only non-null `goldSpeaker`).")
        lines.append("6. Re-run: `python scripts/evaluate_audio_diarization.py --gold eval/gold/calls.jsonl`")
        lines.append("7. Optionally: `--threshold-sweep` and `--runtime-smoke`.")
        lines.append("")
        lines.append("Do **not** treat AssemblyAI, ECAPA, or `speaker_mapping.py` as gold.")
        lines.append("")
        _append_boundary_section(lines)
        _append_runtime_smoke(lines, meta)
        lines.append("### Production flag")
        lines.append("")
        lines.append("`AUDIO_SPEAKER_VALIDATION` must remain **false** in production `.env` until gold metrics justify enabling it.")
        lines.append("")
        lines.append("### Recommended thresholds")
        lines.append("")
        lines.append("**No change.** Without labeled gold, do not tune production thresholds.")
        lines.append("Keep current defaults; prioritize zero false corrections when labels arrive.")
        lines.append("")
        path.write_text("\n".join(lines), encoding="utf-8")
        return

    aai_acc = metrics.aai_correct / metrics.n
    p2_acc = metrics.phase2_correct / metrics.n
    p3_acc = metrics.phase3_correct / metrics.n
    aai_err = metrics.n - metrics.aai_correct
    changed = metrics.correct_correction + metrics.false_correction
    precision = (
        metrics.correct_correction / changed if changed else None
    )
    # recall over AAI errors that should have been fixed
    recall = (
        metrics.correct_correction / aai_err if aai_err else None
    )
    fcr = metrics.false_correction / metrics.n

    lines.append("## Summary")
    lines.append("")
    lines.append("| Metric | AssemblyAI | Phase 2 | Phase 3 |")
    lines.append("| --- | ---: | ---: | ---: |")
    lines.append(
        f"| Speaker accuracy | {pct(metrics.aai_correct, metrics.n)} | "
        f"{pct(metrics.phase2_correct, metrics.n)} | {pct(metrics.phase3_correct, metrics.n)} |"
    )
    lines.append(
        f"| Speaker errors | {aai_err} | {metrics.n - metrics.phase2_correct} | "
        f"{metrics.n - metrics.phase3_correct} |"
    )
    lines.append(f"| Correct corrections | — | — | {metrics.correct_correction} |")
    lines.append(f"| False corrections (introduced errors) | — | — | **{metrics.false_correction}** |")
    lines.append(f"| Missed corrections | — | — | {metrics.missed_correction} |")
    lines.append(
        f"| Uncertain (kept original) | — | — | "
        f"{metrics.uncertain_correct_original + metrics.uncertain_wrong_original} |"
    )
    lines.append("")
    lines.append(f"- Correction precision: {pct(metrics.correct_correction, changed) if changed else 'n/a'}")
    lines.append(f"- Correction recall (vs AAI errors): {pct(metrics.correct_correction, aai_err) if aai_err else 'n/a'}")
    lines.append(f"- False correction rate: {pct(metrics.false_correction, metrics.n)}")
    lines.append("")
    lines.append("Priority: minimize **false corrections** first.")
    lines.append("")

    def section(title: str, outcome: str) -> None:
        lines.append(f"## {title}")
        lines.append("")
        subset = [r for r in rows if r.outcome == outcome]
        if not subset:
            lines.append("_None._")
            lines.append("")
            return
        for r in subset:
            s = r.segment
            lines.append(
                f"- call `{s.call_id}` {s.start_ms}-{s.end_ms}ms dur={s.end_ms - s.start_ms}ms "
                f"type=`{s.segment_type}` text=`{(s.text or '')[:60]}`"
            )
            lines.append(
                f"  AAI={s.aai_speaker} gold={s.gold_speaker} phase2={r.phase2_speaker} "
                f"phase3={r.phase3_speaker} status={r.phase3_status} reason={r.phase3_reason}"
            )
            lines.append(
                f"  simA={r.similarity_to_a} simB={r.similarity_to_b} margin={r.margin}"
            )
        lines.append("")

    section("Correct corrections", "correct_correction")
    section("False corrections (MOST IMPORTANT)", "false_correction")
    section("Missed corrections", "missed_correction")
    section("Uncertain — original was correct", "uncertain_correct_original")
    section("Uncertain — original was wrong", "uncertain_wrong_original")

    lines.append("## By segment type")
    lines.append("")
    for st, d in sorted(metrics.by_type.items()):
        n = d.get("n", 0)
        lines.append(
            f"- `{st}` n={n} aai_acc={pct(d.get('aai_correct', 0), n)} "
            f"phase3_acc={pct(d.get('phase3_correct', 0), n)} "
            f"false_corr={d.get('false_correction', 0)} "
            f"correct_corr={d.get('correct_correction', 0)} "
            f"missed={d.get('missed_correction', 0)}"
        )
    lines.append("")

    lines.append("## Enablement recommendation")
    lines.append("")
    if metrics.false_correction == 0 and metrics.correct_correction > 0 and (precision or 0) >= 0.9:
        lines.append(
            "Measured results show useful corrections with zero false corrections on this gold set. "
            "Still keep production default false until a larger set (15–30 calls) confirms."
        )
    elif metrics.n > 0 and metrics.false_correction > 0:
        lines.append(
            f"**Do not enable** `AUDIO_SPEAKER_VALIDATION` in production: "
            f"{metrics.false_correction} false correction(s) observed."
        )
    else:
        lines.append(
            "Insufficient evidence of improvement (no/low correct corrections). "
            "Keep `AUDIO_SPEAKER_VALIDATION=false`."
        )
    lines.append("")
    lines.append(f"(Accuracy floats: AAI={aai_acc:.4f} P2={p2_acc:.4f} P3={p3_acc:.4f} FCR={fcr:.4f})")
    if precision is not None:
        lines.append(f"(precision={precision:.4f} recall={recall})")
    lines.append("")

    if meta.get("threshold_sweep"):
        lines.append("## Threshold sweep (offline)")
        lines.append("")
        lines.append("| correct_margin | min_speech | island_max | correct_corr | false_corr | missed | uncertain | precision |")
        lines.append("| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
        for row in meta["threshold_sweep"]:
            prec = row.get("correction_precision")
            prec_s = f"{100 * prec:.1f}%" if isinstance(prec, float) else "n/a"
            lines.append(
                f"| {row['correct_margin']} | {row['min_speech_sec']} | {row['island_max_sec']} | "
                f"{row['correct_corrections']} | {row['false_corrections']} | {row['missed_corrections']} | "
                f"{row['uncertain']} | {prec_s} |"
            )
        lines.append("")
        lines.append("Priority: minimize false_corrections, then precision, then recall.")
        lines.append("")

    _append_boundary_section(lines)
    _append_runtime_smoke(lines, meta)

    path.write_text("\n".join(lines), encoding="utf-8")


def _append_boundary_section(lines: list[str]) -> None:
    lines.append("## Boundary words-path investigation")
    lines.append("")
    lines.append(
        "**Conclusion: not a production wiring bug.** Boundary validation was skipped in Phase 3 POC "
        "because utterance-only sidecars had no words."
    )
    lines.append("")
    lines.append("| Question | Answer |")
    lines.append("| --- | --- |")
    lines.append(
        "| Are word timestamps available from AssemblyAI? | Yes — `_parse_stt_payload` builds "
        "`DiarizedWord` from `raw[\"words\"]` (`assemblyai.py`). |"
    )
    lines.append(
        "| Passed into boundary validator in production? | Yes — `analyze()` and "
        "`finalize_from_utterances()` both call `_build_analysis_result(..., words=words, audio_path=...)` "
        "→ `maybe_validate_speakers(..., words=words)`. |"
    )
    lines.append(
        "| Dual-STT path? | `run_dual_transcribe` returns `words`; backend `analyzeRecording.ts` "
        "sends `words` + `audio_path` to `/finalize-transcript`. |"
    )
    lines.append(
        "| Where lost in POC? | `scripts/poc_data/*.utterances.json` store utterances only; "
        "`poc_phase3_validation.py` called validator with `words=[]`. |"
    )
    lines.append(
        "| Silent skip? | No longer silent — logs `boundary_validation=skipped reason=no_words` "
        "when `boundary_validation` is on and words empty. |"
    )
    lines.append(
        "| Wiring fix? | Production words path OK. Minimal bugfix: initialize `scores={}` before "
        "island loop — prior `similarity_to_a/b` wiring raised `UnboundLocalError` on non-island "
        "utterances. Regression tests: `test_boundary_validation_skips_when_words_missing`, "
        "`test_boundary_validation_runs_when_words_present`. |"
    )
    lines.append("")
    lines.append(
        "`remapOnly` intentionally sets `skip_audio_speaker_validation=True` and `audio_path=None` — by design."
    )
    lines.append("")


def _append_runtime_smoke(lines: list[str], meta: dict[str, Any]) -> None:
    smoke = meta.get("runtime_smoke")
    if not smoke:
        lines.append("## Real-runtime verification")
        lines.append("")
        lines.append("Not run in this report. Use `--runtime-smoke` on a template JSONL.")
        lines.append("")
        return
    lines.append("## Real-runtime verification")
    lines.append("")
    lines.append(f"- ECAPA executed on any call: **{smoke.get('ecapa_ran_any')}**")
    lines.append("")
    for c in smoke.get("calls") or []:
        lines.append(
            f"- call `{c.get('callId')}` audio_exists={c.get('audioExists')} "
            f"ecapa={c.get('ecapa_ran')} status={c.get('summary_status')} "
            f"islands={c.get('islands_checked')} island_corr={c.get('island_corrections')} "
            f"boundaries={c.get('boundaries_checked')} boundary_corr={c.get('boundary_corrections')} "
            f"uncertain={c.get('uncertain_regions_count')} aba_present={c.get('aba_pattern_present')}"
        )
        if c.get("short_utterance_outcomes"):
            lines.append("  Short utterances:")
            for s in c["short_utterance_outcomes"][:8]:
                lines.append(
                    f"  - `{s.get('text')}` {s.get('start')}-{s.get('end')}s "
                    f"spk={s.get('speaker')} status={s.get('status')} reason={s.get('reason')}"
                )
        if c.get("error"):
            lines.append(f"  error: {c['error']}")
    lines.append("")
    lines.append("This verifies ECAPA ran; it does **not** prove accuracy without gold labels.")
    lines.append("")


def runtime_smoke(segments: list[GoldSegment], *, max_calls: int = 2) -> dict[str, Any]:
    """Run Phase 3 validator on real audio without requiring gold labels.

    Confirms ECAPA path executes: profiles → islands → boundary (if words) → rebuild.
    Does NOT produce accuracy metrics.
    """
    by_call = group_by_call(segments)
    results: list[dict[str, Any]] = []
    for i, ((_cid, _rid), segs) in enumerate(by_call.items()):
        if i >= max_calls:
            break
        audio = segs[0].audio_path
        entry: dict[str, Any] = {
            "callId": segs[0].call_id,
            "recordingId": segs[0].recording_id,
            "audioPath": str(audio),
            "audioExists": audio.is_file(),
            "segments": len(segs),
        }
        if not audio.is_file():
            entry["error"] = "audio missing"
            results.append(entry)
            continue
        try:
            utts = segments_to_utterances(segs)
            words = synthetic_words_from_segments(segs)
            cfg = ValidationConfig(
                boundary_validation=True,
                long_turn_scan=False,
                long_turn_validation=False,
            )
            out_u, out_w, summary = validate_speakers_audio(
                audio_path=str(audio),
                utterances=utts,
                words=words,
                cfg=cfg,
                recording_id=f"{segs[0].call_id}_{segs[0].recording_id}",
            )
            short_texts = {"okay", "yes", "no", "right", "yeah", "sure", "hmm", "oh", "ok"}
            short_outcomes: list[dict[str, Any]] = []
            for u in out_u:
                t = (u.text or "").strip().lower().rstrip(".,!")
                if t in short_texts or (len(t.split()) <= 2 and (u.end - u.start) <= 1.5):
                    meta = u.speaker_validation
                    short_outcomes.append(
                        {
                            "text": u.text,
                            "start": u.start,
                            "end": u.end,
                            "speaker": u.speaker,
                            "status": meta.speaker_validation_status if meta else None,
                            "reason": meta.speaker_validation_reason if meta else None,
                            "original": meta.original_speaker if meta else None,
                        }
                    )
            # A→B→A interruption pattern check (must not auto-collapse to A→A→A without evidence)
            speakers = [u.speaker for u in out_u]
            aba = any(
                speakers[j] == speakers[j + 2]
                and speakers[j] != speakers[j + 1]
                for j in range(len(speakers) - 2)
            )
            entry.update(
                {
                    "ecapa_ran": bool(summary.method),
                    "summary_status": summary.status,
                    "method": summary.method,
                    "profile_status": summary.profile_status,
                    "profile_separation": summary.profile_separation,
                    "islands_checked": summary.islands_checked,
                    "island_corrections": summary.island_corrections,
                    "boundaries_checked": summary.boundaries_checked,
                    "boundary_corrections": summary.boundary_corrections,
                    "corrections_count": summary.corrections_count,
                    "uncertain_regions_count": summary.uncertain_regions_count,
                    "timing_ms": summary.timing_ms,
                    "utterances_out": len(out_u),
                    "words_out": len(out_w),
                    "aba_pattern_present": aba,
                    "short_utterance_outcomes": short_outcomes[:20],
                    "notes": summary.notes,
                }
            )
        except Exception as exc:  # noqa: BLE001
            entry["error"] = str(exc)
        results.append(entry)
    return {"calls": results, "ecapa_ran_any": any(r.get("ecapa_ran") for r in results)}


def threshold_sweep(
    gold_rows: list[GoldSegment],
    *,
    use_synthetic_words: bool,
) -> list[dict[str, Any]]:
    """Offline threshold grid. Requires labeled gold. Does not change production defaults."""
    labeled = [g for g in gold_rows if g.labeled]
    if not labeled:
        return []

    grids = [
        {"correct_margin": 0.15, "confirm_margin": 0.08, "min_speech_sec": 1.0, "island_max_sec": 3.0},
        {"correct_margin": 0.20, "confirm_margin": 0.10, "min_speech_sec": 1.0, "island_max_sec": 3.0},
        {"correct_margin": 0.25, "confirm_margin": 0.12, "min_speech_sec": 1.2, "island_max_sec": 2.5},
        {"correct_margin": 0.30, "confirm_margin": 0.15, "min_speech_sec": 1.5, "island_max_sec": 2.0},
        {"correct_margin": 0.15, "confirm_margin": 0.08, "min_speech_sec": 0.8, "island_max_sec": 4.0},
    ]
    out: list[dict[str, Any]] = []
    by_call = group_by_call(labeled)

    for grid in grids:
        metrics = Metrics()
        errors: list[str] = []
        for (_cid, _rid), segs in by_call.items():
            try:
                audio = segs[0].audio_path
                utts = segments_to_utterances(segs)
                words = synthetic_words_from_segments(segs) if use_synthetic_words else []
                cfg = ValidationConfig(
                    boundary_validation=True,
                    long_turn_scan=False,
                    long_turn_validation=False,
                    **grid,
                )
                out3, _, _summary = validate_speakers_audio(
                    audio_path=str(audio),
                    utterances=utts,
                    words=words,
                    cfg=cfg,
                    recording_id=f"{segs[0].call_id}_{segs[0].recording_id}",
                )
            except Exception as exc:  # noqa: BLE001
                errors.append(f"{segs[0].call_id}: {exc}")
                continue
            for s in segs:
                gold = str(s.gold_speaker).upper()
                mid = (s.start_sec + s.end_sec) / 2.0
                p3, meta3 = speaker_at_time(out3, mid, s.aai_speaker)
                status = meta3.speaker_validation_status if meta3 else "skipped"
                outcome = classify_outcome(gold=gold, aai=s.aai_speaker, phase3=p3, status=status)
                metrics.n += 1
                if s.aai_speaker == gold:
                    metrics.aai_correct += 1
                if p3 == gold:
                    metrics.phase3_correct += 1
                setattr(metrics, outcome, getattr(metrics, outcome) + 1)

        changed = metrics.correct_correction + metrics.false_correction
        out.append(
            {
                **grid,
                "n": metrics.n,
                "phase3_accuracy": (metrics.phase3_correct / metrics.n) if metrics.n else None,
                "correct_corrections": metrics.correct_correction,
                "false_corrections": metrics.false_correction,
                "missed_corrections": metrics.missed_correction,
                "uncertain": metrics.uncertain_correct_original + metrics.uncertain_wrong_original,
                "correction_precision": (metrics.correct_correction / changed) if changed else None,
                "errors": errors,
            }
        )
    return out


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold", required=True, help="JSONL gold or template file")
    parser.add_argument(
        "--report",
        default=str(ROOT / "eval" / "DIARIZATION_EVAL_REPORT.md"),
    )
    parser.add_argument(
        "--synthetic-words",
        action="store_true",
        default=True,
        help="Build approximate words from utterance text for Phase 3 boundary path (default on)",
    )
    parser.add_argument("--no-synthetic-words", action="store_true")
    parser.add_argument(
        "--runtime-smoke",
        action="store_true",
        help="Run ECAPA on unlabeled templates (no accuracy metrics); verifies real runtime path",
    )
    parser.add_argument("--smoke-max-calls", type=int, default=2)
    parser.add_argument(
        "--threshold-sweep",
        action="store_true",
        help="Offline threshold grid (requires labeled goldSpeaker)",
    )
    args = parser.parse_args()

    gold_path = Path(args.gold)
    if not gold_path.is_absolute():
        gold_path = (Path.cwd() / gold_path).resolve()
        if not gold_path.is_file():
            gold_path = (ROOT / args.gold).resolve()

    use_words = not args.no_synthetic_words
    rows = load_gold(gold_path)

    report_path = Path(args.report)
    if not report_path.is_absolute():
        report_path = (ROOT / args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)

    smoke_meta: dict[str, Any] | None = None
    if args.runtime_smoke:
        smoke_meta = runtime_smoke(rows, max_calls=args.smoke_max_calls)
        smoke_path = report_path.parent / "RUNTIME_SMOKE.json"
        smoke_path.write_text(json.dumps(smoke_meta, indent=2), encoding="utf-8")
        print(f"runtime_smoke ecapa_ran_any={smoke_meta.get('ecapa_ran_any')} -> {smoke_path}")

    sweep_rows: list[dict[str, Any]] = []
    if args.threshold_sweep:
        sweep_rows = threshold_sweep(rows, use_synthetic_words=use_words)
        sweep_path = report_path.parent / "THRESHOLD_SWEEP.json"
        sweep_path.write_text(json.dumps(sweep_rows, indent=2), encoding="utf-8")
        print(f"threshold_sweep configs={len(sweep_rows)} -> {sweep_path}")

    metrics, eval_rows, meta = evaluate(rows, use_synthetic_words=use_words)
    if smoke_meta is not None:
        meta["runtime_smoke"] = smoke_meta
    if sweep_rows:
        meta["threshold_sweep"] = sweep_rows

    write_report(report_path, metrics=metrics, rows=eval_rows, meta=meta, gold_path=gold_path)

    print(f"labeled={meta['labeled_rows']} unlabeled={meta['unlabeled_rows']} calls={meta['calls_evaluated']}")
    print(f"report={report_path}")
    if metrics.n:
        print(
            f"aai_acc={pct(metrics.aai_correct, metrics.n)} "
            f"p2_acc={pct(metrics.phase2_correct, metrics.n)} "
            f"p3_acc={pct(metrics.phase3_correct, metrics.n)} "
            f"false_corrections={metrics.false_correction} "
            f"correct_corrections={metrics.correct_correction}"
        )
    else:
        print("No labeled goldSpeaker rows — metrics not computed. See report.")


if __name__ == "__main__":
    # validate_speakers_audio does not check AUDIO_SPEAKER_VALIDATION (maybe_validate does).
    main()
