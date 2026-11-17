"""启动实时服务：python -m backend [--host 0.0.0.0] [--port 8000] [--data-dir DIR] [--topo FILE] [--kg FILE]"""
from __future__ import annotations

import argparse
import os

import uvicorn


def main():
    ap = argparse.ArgumentParser(description="5GC CHR 故障感知与分析（实时运行）")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data-dir", help="CHR 文件目录（chr_*.csv，持续追加），默认仓库 data/")
    ap.add_argument("--topo", help="拓扑文件，默认 topo/topo.csv")
    ap.add_argument("--kg", help="知识图谱文件，默认 chr-knowledge-graph/graph.json")
    args = ap.parse_args()
    for env, value in (("CCN_DATA_DIR", args.data_dir), ("CCN_TOPO_FILE", args.topo), ("CCN_KG_FILE", args.kg)):
        if value:
            os.environ[env] = os.path.abspath(value)
    uvicorn.run("backend.server:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
