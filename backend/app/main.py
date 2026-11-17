from __future__ import annotations

from collections import OrderedDict
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
from threading import RLock
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from typing import Literal

from .config import DATA_DIR, TOPO_FILE, KNOWLEDGE_FILE, ROOT
from .engine import Engine
from .ingestion import load_data, load_topology, normalize_rows
from .reasoning import load_graph
from .simulation import generate

RUNS: OrderedDict[str, Engine] = OrderedDict()
LOCK = RLock()


def file_engine():
    records, quality = load_data(DATA_DIR)
    return Engine(records, quality, load_topology(TOPO_FILE), load_graph(KNOWLEDGE_FILE))


@asynccontextmanager
async def lifespan(app):
    RUNS["default"] = file_engine()
    yield


app = FastAPI(title="CHRONOS CHR Observatory", version="1.0.0", lifespan=lifespan,
              description="CHR perception, significance analysis and evidence-based reasoning. No execution of network changes.")


def engine_for(run_id):
    with LOCK:
        engine = RUNS.get(run_id)
    if engine is None:
        raise HTTPException(404, "运行已过期或不存在，请重新创建仿真运行")
    return engine


def validate_minute(engine, minute):
    if not 1 <= minute <= engine.detector.duration:
        raise HTTPException(422, f"minute must be between 1 and {engine.detector.duration}")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "chronos", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/meta")
def meta(run_id: str = "default"):
    return {"run_id": run_id, **engine_for(run_id).meta()}


@app.get("/api/snapshot")
def snapshot(minute: int = Query(24, ge=1), run_id: str = "default"):
    engine = engine_for(run_id)
    validate_minute(engine, minute)
    return engine.snapshot(minute)


@app.get("/api/events")
def events(minute: int = Query(24, ge=1), run_id: str = "default"):
    engine = engine_for(run_id)
    validate_minute(engine, minute)

    def stream():
        try:
            for event in engine.events(minute):
                yield f"event: {event['type']}\ndata: {json.dumps(event['data'], ensure_ascii=False, allow_nan=False)}\n\n"
        except Exception:
            # Do not leave clients hanging or present a partial analysis as a completed result.
            yield 'event: pipeline_error\ndata: {"message":"分析失败，请检查服务端数据格式与日志后重试"}\n\n'
            raise

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class SimulationRequest(BaseModel):
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    scenario: Literal["packet_loss", "normal", "transient"] = "packet_loss"
    fault_instance: Literal["SMF:smf_1", "SMF:smf_2"] = "SMF:smf_2"


@app.post("/api/runs", status_code=201)
def create_run(request: SimulationRequest):
    rows, _ = generate(request.seed, request.scenario, request.fault_instance)
    records, quality = normalize_rows(rows)
    labels = {"packet_loss": "持续链路丢包", "normal": "正常背景噪声", "transient": "两分钟瞬时尖峰"}
    engine = Engine(records, quality, load_topology(TOPO_FILE), load_graph(KNOWLEDGE_FILE),
                    f"{labels[request.scenario]} · seed {request.seed}")
    run_id = uuid4().hex
    with LOCK:
        RUNS[run_id] = engine
        while len(RUNS) > 9:
            oldest = next(key for key in RUNS if key != "default")
            del RUNS[oldest]
    return {"run_id": run_id, **engine.meta()}


@app.post("/api/reload")
def reload_files():
    try:
        fresh = file_engine()
    except (ValueError, OSError, KeyError) as exc:
        raise HTTPException(422, str(exc)) from exc
    with LOCK:
        RUNS["default"] = fresh
    return {"run_id": "default", **fresh.meta()}


@app.get("/api/report")
def report(minute: int = Query(24, ge=1), run_id: str = "default", format: Literal["json", "markdown"] = "json"):
    engine = engine_for(run_id)
    validate_minute(engine, minute)
    result = engine.snapshot(minute)
    if format == "json":
        return Response(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False), media_type="application/json",
                        headers={"Content-Disposition": f'attachment; filename="chr-report-minute-{minute}.json"'})
    conclusion = result["reasoning"]["conclusion"]
    p = result["perception"]
    lines = ["# CHR 故障分析报告", "", f"分析窗口：{p['window_start']} 至 {p['window_end']}（右开区间）", "",
             f"结论：{conclusion['summary'] if conclusion else '未形成唯一结论；' + result['reasoning']['status']}", "",
             f"检查 {p['dimensions']} 个时序维度；{p['raw_count']} 条 CHR → {p['retained_count']} 条；过滤 {p['removed_percent']}%。",
             f"确认 {p['confirmed_dimensions']} 个维度；精确关联 {result['flows']['correlated']} 条跨网元用户流程。", ""]
    if conclusion:
        lines += ["## 关键证据", ""] + [f"- {'匹配' if e['matched'] else '缺失'}：{e['label']}" for e in conclusion["evidence"]]
        lines += ["", f"规则证据覆盖率：{conclusion['score']:.0%}，不是校准概率。", "", "## 恢复建议（未执行）", ""]
        lines += [f"{i}. {step}" for i, step in enumerate(conclusion["recovery"]["steps"], 1)]
        lines += ["", "执行前提："] + [f"- {p}" for p in conclusion["recovery"]["preconditions"]]
        lines += ["", f"证据边界：{conclusion['limitations']}"]
    elif result["reasoning"]["slow_reasoning"]:
        slow = result["reasoning"]["slow_reasoning"]
        lines += [slow["reason"], "", slow["message"]] + [f"- {t['tool']}：{t['action']}（未执行）" for t in slow["tasks"]]
    lines += ["", "## 聚集性检验", "", "| 网元 / 流程 / 原因码 | 维度 | 聚集值 | 占比 | Lift | q 值 |", "|---|---|---|---:|---:|---:|"]
    for group in result["clusters"]["groups"]:
        for feature in group["features"]:
            if feature["severity"] in ("strong", "significant"):
                lines.append(f"| {group['nf']} / {group['procedure']} / {group['cause']} | {feature['label']} | {feature['value']} | {feature['share']:.1%} | {feature['lift']} | {feature['q_value']:.2g} |")
    lines += ["", f"图谱版本：{result['reasoning']['graph_version']}。", "决策交接已生成但未发送，决策执行模块未实现。", ""]
    return Response("\n".join(lines), media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="chr-report-minute-{minute}.md"'})


dist = ROOT / "frontend/dist"
if dist.exists():
    app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
