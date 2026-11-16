"""HTTP 服务。

    uvicorn backend.server:app --port 8000

GET /api/meta              数据与配置概览
GET /api/topology          拓扑
GET /api/knowledge-graph   知识图谱全量
GET /api/run/stream        回放事件流（SSE），speed 为播放倍速，0 表示不停顿
前端构建产物存在时（frontend/dist），同时托管静态页面。
"""
from __future__ import annotations

import json
import time
from functools import lru_cache

import numpy as np
from fastapi import FastAPI, Query
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT
from .pipeline import Pipeline

app = FastAPI(title="5GC CHR 故障感知与分析")


@lru_cache(maxsize=1)
def pipeline() -> Pipeline:
    return Pipeline()


def _default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, (set, tuple)):
        return list(o)
    return str(o)


@app.get("/api/meta")
def meta():
    return pipeline().meta()


@app.get("/api/topology")
def topology():
    return pipeline().topo.to_dict()


@app.get("/api/knowledge-graph")
def knowledge_graph():
    kg = pipeline().kg
    return {"meta": kg.meta, "nodes": list(kg.nodes.values()), "edges": kg.edges}


@app.get("/api/run/stream")
def run_stream(speed: float = Query(1.0, ge=0, le=20)):
    def gen():
        for ev in pipeline().run():
            delay = ev.pop("delay", 0)
            yield f"data: {json.dumps(ev, ensure_ascii=False, default=_default)}\n\n"
            if speed > 0 and delay:
                time.sleep(delay / speed)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_dist = ROOT / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
