"""按场景落盘 + 回放测试。"""
from __future__ import annotations

import asyncio
import json


class _CollectBus:
    def __init__(self):
        self.events: list[tuple[str, dict]] = []

    def publish(self, type_: str, payload: dict) -> None:
        self.events.append((type_, payload))


def test_recorder_snapshots_to_replay_dir(tmp_path):
    """finalize 把 session 数据复制到 live_replay/{scenario_id}/(按场景留存)。"""
    from agents.shared.live_data_recorder import LiveDataRecorder

    rec = LiveDataRecorder(session_id="sess_x", scenario_id="A", base_dir=str(tmp_path))
    rec.record_event("runner_state", {"state": "simulating"})
    rec.record_event("tick", {"sim_t": 1})
    rec.record_event("diagnosis_complete", {"fault_elements": ["UPF_1"]})
    rec.finalize("done")

    replay_dir = tmp_path / "live_replay" / "A"
    assert replay_dir.is_dir(), f"replay dir not created: {replay_dir}"
    assert (replay_dir / "events.jsonl").is_file()
    assert (replay_dir / "session_meta.json").is_file()
    # 回放 events.jsonl 含原事件
    ev_types = {
        json.loads(ln)["type"]
        for ln in (replay_dir / "events.jsonl").read_text(encoding="utf-8").splitlines()
        if ln.strip()
    }
    assert "runner_state" in ev_types
    assert "diagnosis_complete" in ev_types


def test_stream_replay_publishes_events(tmp_path):
    """_stream_replay 读 events.jsonl 按序重发到 bus。"""
    from api.routes.live import _stream_replay

    events_file = tmp_path / "events.jsonl"
    events_file.write_text(
        "\n".join(json.dumps({"type": t, "payload": p}) for t, p in [
            ("runner_state", {"state": "simulating"}),
            ("phase_change", {"phase": 1}),
            ("diagnosis_complete", {"fault_elements": ["UPF_1"]}),
        ]),
        encoding="utf-8",
    )
    bus = _CollectBus()
    asyncio.run(_stream_replay(bus, events_file))
    types = [t for t, _ in bus.events]
    assert types == ["runner_state", "phase_change", "diagnosis_complete"]
    assert bus.events[2][1]["fault_elements"] == ["UPF_1"]


def test_replay_endpoint_404_when_no_data(client=None):
    """无回放数据时 /replay 返回 404。"""
    from fastapi.testclient import TestClient

    from api.app import create_app
    app = create_app()
    c = TestClient(app)
    r = c.post("/api/v1/live/replay", json={"scenario_id": "ZZ_NONE"})
    assert r.status_code == 404
