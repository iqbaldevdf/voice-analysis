"""Summarize gold labeling progress (developer only)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from gold_labeling.store import GoldLabelStore  # noqa: E402
from gold_labeling.validate import validate_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold-dir", default=None)
    parser.add_argument("--labeler-id", default="default")
    args = parser.parse_args()
    gold_dir = Path(args.gold_dir) if args.gold_dir else None
    store = GoldLabelStore(gold_dir=gold_dir, labeler_id=args.labeler_id)
    s = store.progress_summary()
    print(f"Calls: {s['calls']}")
    print(f"Segments: {s['segments']}")
    print(f"Gold A/B labeled: {s['gold_ab_labeled']}")
    print(f"  A: {s['A']}")
    print(f"  B: {s['B']}")
    print(f"Overlap: {s['overlap']}")
    print(f"Unclear: {s['unclear']}")
    print(f"Skipped: {s['skipped']}")
    print(f"Remaining: {s['remaining']}")
    print(f"Calls with A/B labels: {s['calls_with_ab']}")
    print(
        f"Calls meeting min A/B ({s['ready_criteria']['min_ab_per_ready_call']}): "
        f"{s['calls_meeting_min_ab']}"
    )
    print(f"Ready for evaluation: {'YES' if s['ready_for_evaluation'] else 'NO'}")
    print(
        f"(criteria: >= {s['ready_criteria']['min_ab_labels']} A/B labels and "
        f">= {s['ready_criteria']['min_calls_with_ab']} calls with "
        f">= {s['ready_criteria']['min_ab_per_ready_call']} A/B each)"
    )
    v = validate_store(store)
    if not v["ok"]:
        print(f"Validation errors: {len(v['errors'])}")
        for err in v["errors"][:20]:
            print(f"  - {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()
