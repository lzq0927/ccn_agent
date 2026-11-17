"""离线分析历史 CHR：python -m backend.cli [--json]"""
from __future__ import annotations

import argparse
import json

from .pipeline import Pipeline


def main():
    ap = argparse.ArgumentParser(description="对 data 目录中的历史 CHR 做离线分析")
    ap.add_argument("--json", action="store_true", help="只输出结论 JSON")
    args = ap.parse_args()
    conclusion = None
    for ev in Pipeline().run():
        if ev["type"] == "log" and not args.json:
            print(f"{ev['time']} [{ev['stage']}] {ev['text']}")
        elif ev["type"] == "result" and ev["key"] == "conclusion":
            conclusion = ev["data"]
    if args.json and conclusion:
        conclusion.pop("node_stats", None)
        print(json.dumps(conclusion, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
