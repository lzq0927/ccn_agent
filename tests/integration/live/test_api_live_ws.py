from fastapi.testclient import TestClient
import threading
import time


def test_ws_receives_runner_state_events():
    from api.app import create_app
    app = create_app()
    client = TestClient(app)
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    with client.websocket_connect(f"/ws/live?session_id={sid}") as ws:
        events = []
        deadline = time.time() + 10
        while time.time() < deadline and len(events) < 3:
            try:
                msg = ws.receive_text()
                if msg == "pong":
                    continue
                events.append(msg)
            except Exception:
                break
        assert len(events) >= 1