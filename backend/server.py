"""HTTP 服务。

    python -m backend --port 8000 [--data-dir <CHR 目录>] [--realtime]

GET  /api/meta             运行配置概览
POST /api/control          运行控制：action=start|pause|resume|restart（按数据时间推进时可用）
GET  /api/topology         拓扑
GET  /api/knowledge-graph  知识图谱全量
GET  /api/state            当前状态快照（JSON）
GET  /api/stream           事件流（SSE）：先推一份快照，再持续推送后续事件
前端构建产物存在时（frontend/dist），同时托管静态页面。
"""
from __future__ import annotations

import json
import os
import queue
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .config import ROOT
from .runner import BaseRunner, create_runner

runner: BaseRunner | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global runner
    runner = create_runner(mode=os.environ.get("CCN_MODE", "step"))
    runner.start()
    yield
    runner.stop()


app = FastAPI(title="5GC CHR 故障感知与分析", lifespan=lifespan)


def _default(o):
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, np.floating):
        return float(o)
    if isinstance(o, (set, tuple)):
        return list(o)
    return str(o)


def _dumps(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, default=_default)


@app.get("/api/meta")
def meta():
    e, s = runner.engine, runner.s
    return {"mode": runner.mode, "instances": len(e.topo.nodes), "links": len(e.topo.edges),
            "started_at": runner.started_at, "files": runner.files(),
            "settings": {"window_min": s.window_min, "sustain_n": s.sustain_n, "sustain_m": s.sustain_m,
                         "z_threshold": s.z_threshold, "recover_min": s.recover_min},
            "kg": {"nodes": len(e.kg.nodes), "edges": len(e.kg.edges), "version": e.kg.meta.get("version", "")}}


@app.post("/api/control")
def control(action: str = Query(..., pattern="^(start|pause|resume|restart)$")):
    return runner.control(action)


@app.get("/api/topology")
def topology():
    return runner.engine.topo.to_dict()


@app.get("/api/knowledge-graph")
def knowledge_graph():
    kg = runner.engine.kg
    return {"meta": kg.meta, "nodes": list(kg.nodes.values()), "edges": kg.edges}


@app.get("/api/state")
def state():
    return JSONResponse(json.loads(_dumps(runner.snapshot())))


@app.get("/api/stream")
def stream():
    def gen():
        q, snap = runner.subscribe()
        try:
            yield f"data: {_dumps(snap)}\n\n"
            while True:
                try:
                    yield f"data: {_dumps(q.get(timeout=15))}\n\n"
                except queue.Empty:
                    yield ": keep-alive\n\n"
        finally:
            runner.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


_dist = ROOT / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
