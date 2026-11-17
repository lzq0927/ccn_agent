"""启动服务：python -m backend [--host 0.0.0.0] [--port 8000] [--data-dir DIR] [--topo FILE] [--kg FILE] [--realtime]"""
from __future__ import annotations

import argparse
import os

import uvicorn


def main():
    ap = argparse.ArgumentParser(description="5GC CHR 故障感知与分析")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--data-dir", help="CHR 文件目录（chr_*.csv），默认仓库 data/")
    ap.add_argument("--realtime", action="store_true", help="按服务器真实时间每分钟处理一次（默认按数据时间每秒推进 1 分钟）")
    ap.add_argument("--topo", help="拓扑文件，默认 topo/topo.csv")
    ap.add_argument("--kg", help="知识图谱文件，默认 chr-knowledge-graph/graph.json")
    args = ap.parse_args()
    for env, value in (("CCN_DATA_DIR", args.data_dir), ("CCN_TOPO_FILE", args.topo), ("CCN_KG_FILE", args.kg)):
        if value:
            os.environ[env] = os.path.abspath(value)
    if args.realtime:
        os.environ["CCN_MODE"] = "realtime"
    uvicorn.run("backend.server:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
