"""
Phase 3 POC: robust profiles + island/boundary validation on real Freshcaller WAVs.

Usage:
  python scripts/poc_phase3_validation.py --audio path.wav --utterances-json path.json

Does not change production thresholds. Reports timings and summary diagnostics.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Ensure ai-service root on path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ.setdefault("AUDIO_SPEAKER_VALIDATION", "true")

from app.pipeline.audio_speaker_validation import ValidationConfig, validate_speakers_audio  # noqa: E402
from app.schemas import DiarizedUtterance, DiarizedWord  # noqa: E402


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=True)
    p.add_argument("--utterances-json", required=True)
    p.add_argument("--words-json", default="")
    p.add_argument("--long-turn-scan", action="store_true")
    args = p.parse_args()

    utts_raw = json.loads(Path(args.utterances_json).read_text(encoding="utf-8"))
    utterances = [
        DiarizedUtterance(
            speaker=u["speaker"],
            start=float(u["start"]),
            end=float(u["end"]),
            text=str(u.get("text") or ""),
        )
        for u in utts_raw
    ]
    words: list[DiarizedWord] = []
    if args.words_json and Path(args.words_json).is_file():
        for w in json.loads(Path(args.words_json).read_text(encoding="utf-8")):
            words.append(
                DiarizedWord(
                    speaker=w["speaker"],
                    start=float(w["start"]),
                    end=float(w["end"]),
                    word=str(w.get("word") or w.get("text") or ""),
                )
            )

    cfg = ValidationConfig(
        boundary_validation=True,
        long_turn_scan=bool(args.long_turn_scan),
        long_turn_validation=False,
    )

    t0 = time.perf_counter()
    out_u, out_w, summary = validate_speakers_audio(
        audio_path=args.audio,
        utterances=utterances,
        words=words,
        cfg=cfg,
        recording_id=Path(args.audio).stem,
    )
    wall_ms = (time.perf_counter() - t0) * 1000.0

    print(f"audio={Path(args.audio).name}")
    print(f"utterances_in={len(utterances)} words_in={len(words)} utterances_out={len(out_u)}")
    print(f"wall_ms={wall_ms:.1f}")
    print(summary.model_dump_json(indent=2))
    corrected = [
        u
        for u in out_u
        if u.speaker_validation and u.speaker_validation.speaker_validation_status == "corrected"
    ]
    print(f"corrected_utterances={len(corrected)}")
    for u in corrected[:10]:
        meta = u.speaker_validation
        print(
            f"  {u.start:.2f}-{u.end:.2f} {meta.original_speaker}->{meta.validated_speaker} "
            f"src={meta.speaker_validation_source} reason={meta.speaker_validation_reason} "
            f"margin={meta.speaker_validation_margin}"
        )


if __name__ == "__main__":
    main()
