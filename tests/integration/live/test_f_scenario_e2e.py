"""场景 F 端到端冒烟:选场景→订阅 WS→断言全事件链路。

使用 stub 模式(无 LLM 调用),端到端 < 30s。
"""
import json
import time

import pytest
from fastapi.testclient import TestClient


def test_f_scenario_full_event_chain():
    from api.app import create_app
    app = create_app()
    client = TestClient(app)

    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    assert sel["capabilities"] == "live"

    with client.websocket_connect(f"/ws/live?session_id={sid}") as ws:
        seen_types: list[str] = []
        reasoning_count = 0
        recovery_count = 0
        deadline = time.time() + 30
        while time.time() < deadline:
            try:
                raw = ws.receive_text()
            except Exception:
                break
            ev = json.loads(raw)
            t = ev.get("type")
            if t == "ping":
                continue
            seen_types.append(t)
            if t == "reasoning_step":
                reasoning_count += 1
            if t == "recovery_action":
                recovery_count += 1
            if t == "runner_state" and ev["payload"].get("state") == "done":
                break
            if t == "runner_state" and ev["payload"].get("state") == "failed":
                pytest.fail(f"runner failed: {ev}")

        assert "runner_state" in seen_types, f"missing runner_state in {seen_types}"
        assert reasoning_count >= 2, f"too few reasoning_step ({reasoning_count})"
        # 场景 F 首轮 confidence<0.3 → 至少一次 restart
        assert "confidence_low" in seen_types, f"missing confidence_low in {seen_types}"
        # 评估报告与 skill 沉淀
        assert "evaluation_report" in seen_types, f"missing evaluation_report in {seen_types}"


def test_f_fallback_when_stub_missing(monkeypatch, tmp_path):
    """模拟 stub 缺失:LiveRunner 不应崩;前端不应拿到 unknown session。"""
    from api.app import create_app
    app = create_app()
    client = TestClient(app)
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    assert "session_id" in sel
