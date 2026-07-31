import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from api.app import create_app
    app = create_app()
    return TestClient(app)


def test_capabilities_returns_registry(client):
    r = client.get("/api/v1/live/capabilities")
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, dict)
    # live_scenarios(A~G)现在都是真实实时仿真 → 全 live
    assert data.get("A") == "live"
    assert data.get("F") == "live"
    assert data.get("G") == "live"


def test_select_starts_session(client):
    r = client.post("/api/v1/live/select", json={"scenario_id": "F"})
    assert r.status_code == 200
    data = r.json()
    assert "session_id" in data
    assert data["scenario_id"] == "F"


def test_control_pause_resume(client):
    sel = client.post("/api/v1/live/select", json={"scenario_id": "F"}).json()
    sid = sel["session_id"]
    r = client.post("/api/v1/live/control", json={"session_id": sid, "action": "pause"})
    assert r.status_code == 200
    r = client.post("/api/v1/live/control", json={"session_id": sid, "action": "resume"})
    assert r.status_code == 200


def test_select_unknown_scenario_404(client):
    r = client.post("/api/v1/live/select", json={"scenario_id": "Z_NONEXIST"})
    assert r.status_code == 404
