"""Compare dual-STT agreement on fixture text pairs (offline WER check)."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.pipeline.transcript_compare import compare_transcripts  # noqa: E402


def main() -> None:
    pairs = [
        ("hello world", "hello world"),
        ("payment not received", "payment received"),
    ]
    for a, b in pairs:
        r = compare_transcripts(a, b)
        print(f"A: {a}")
        print(f"B: {b}")
        print(f"  wer={r.wer:.3f} similarity={r.similarity:.3f} auto_accept={r.auto_accept}")
        if r.critical_mismatches:
            print(f"  critical={r.critical_mismatches}")
        print()


if __name__ == "__main__":
    main()
