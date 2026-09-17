"""Export progress labels to calls.jsonl (A/B) and excluded.jsonl."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from gold_labeling.store import GoldLabelStore  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gold-dir", default=None)
    args = parser.parse_args()
    gold_dir = Path(args.gold_dir) if args.gold_dir else None
    store = GoldLabelStore(gold_dir=gold_dir)
    result = store.export()
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
