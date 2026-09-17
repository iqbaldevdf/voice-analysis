"""Validate gold templates + labels (developer only)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from gold_labeling.store import GoldLabelStore  # noqa: E402
from gold_labeling.validate import validate_store  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold-dir", default=None)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    gold_dir = Path(args.gold_dir) if args.gold_dir else None
    store = GoldLabelStore(gold_dir=gold_dir)
    result = validate_store(store)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"ok={result['ok']}")
        for err in result["errors"]:
            print(f"ERROR: {err}")
        for warn in result["warnings"]:
            print(f"WARN: {warn}")
        s = result["summary"]
        print(
            f"segments={s['segments']} ab={s['gold_ab_labeled']} "
            f"remaining={s['remaining']} ready={s['ready_for_evaluation']}"
        )
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
