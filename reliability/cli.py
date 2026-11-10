"""Source-checkout launcher and model-independent experiment CLI."""

import argparse
import asyncio
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from reliability.catalog import capabilities
from reliability.models import Design
from reliability.opencode import OpenCodeAdapter
from reliability.service import ReliabilityService
from reliability.store import ROOT, Store


def main():
    parser = argparse.ArgumentParser(description="ReMAP AI 系统可靠性机制设计与仿真")
    parser.add_argument("--data-dir", type=Path, help="独立实验目录，默认 storage/reliability")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("capabilities")
    commands.add_parser("doctor")
    agent = commands.add_parser("agent", help="启动 OpenCode 官方 Web 界面")
    agent.add_argument("--port", type=int, default=4096)
    run = commands.add_parser("run", help="从 JSON 方案执行离线基线/候选仿真")
    run.add_argument("design", type=Path)
    replay = commands.add_parser("replay")
    replay.add_argument("run_id")
    report = commands.add_parser("report")
    report.add_argument("run_id")
    args = parser.parse_args()
    if args.command == "capabilities":
        print(json.dumps(capabilities(), ensure_ascii=False, indent=2))
    elif args.command == "doctor":
        print(json.dumps(asyncio.run(OpenCodeAdapter().health()), ensure_ascii=False))
    elif args.command == "agent":
        executable = os.getenv("OPENCODE_BIN") or shutil.which("opencode")
        if not executable:
            parser.error("未找到 OpenCode；请安装官方 opencode-ai 或设置 OPENCODE_BIN")
        if not (ROOT / "opencode.json").exists():
            parser.error("Agent 启动需要源码目录中的 opencode.json 和 .opencode 配置")
        env = dict(os.environ)
        env["PATH"] = str(Path(sys.executable).parent) + os.pathsep + env.get("PATH", "")
        if args.data_dir:
            env["CCN_RELIABILITY_DATA"] = str(args.data_dir.resolve())
        raise SystemExit(subprocess.call(
            [executable, "web", "--hostname", "127.0.0.1", "--port", str(args.port)],
            cwd=ROOT, env=env,
        ))
    else:
        service = ReliabilityService(Store(args.data_dir))
        if args.command == "run":
            design = service.create_design(Design.model_validate_json(args.design.read_text()))
            result = service.run(design["id"], design["revision"])
        elif args.command == "replay":
            result = service.replay(args.run_id)
        else:
            print(service.report(args.run_id))
            return
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
