import httpx
import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.routes.reliability import get_agent, get_service
from reliability.opencode import OpenCodeAdapter, OpenCodeUnavailable
from reliability.service import ReliabilityService
from reliability.store import Store


@pytest.fixture
def client(tmp_path):
    app = create_app()
    app.dependency_overrides[get_service] = lambda: ReliabilityService(Store(tmp_path))
    with TestClient(app) as client:
        yield client


def test_api_complete_experiment_and_conflict(client):
    prefix = "/api/v1/reliability"
    assert client.get(prefix + "/capabilities").json()["agent"]["runtime"] == "opencode"
    assert client.get(prefix + "/knowledge?query=重选").json()["entities"]
    response = client.post(prefix + "/designs", json={"name": "API test", "seeds": [42]})
    assert response.status_code == 201
    item = response.json()
    endpoint = prefix + "/designs/" + item["id"]
    assert client.get(endpoint).json() == item
    assert client.post(endpoint + "/runs", json={"expected_revision": 2}).status_code == 409
    run = client.post(endpoint + "/runs", json={"expected_revision": 1})
    assert run.status_code == 201
    run = run.json()
    assert client.get(endpoint + "/runs").json()[0]["id"] == run["id"]
    replay = client.post(prefix + f"/runs/{run['id']}/replay").json()
    assert replay["result_hash"] == run["result_hash"]
    report = client.get(prefix + f"/runs/{run['id']}/report")
    assert report.status_code == 200 and "attachment" in report.headers["Content-Disposition"]
    assert "input" not in client.get(endpoint + "/runs").json()[0]
    assert client.get(prefix + "/runs/missing").status_code == 404
    assert client.post(prefix + "/designs", json={"name": "bad", "seeds": [42, 42]}).status_code == 422
    assert client.post(prefix + "/designs", json={"name": "bad", "actions": [
        {"kind": "isolate", "ne_id": "unknown"}]}).status_code == 422


def test_opencode_session_binding_and_offline_status(client, monkeypatch, tmp_path):
    requests = []

    def respond(request):
        requests.append(request)
        assert request.headers["authorization"] == "Basic b3BlbmNvZGU6dGVzdA=="
        if request.url.path == "/global/health":
            assert "directory" not in request.url.params
            return httpx.Response(200, json={"healthy": True, "version": "test"})
        assert request.url.params["directory"] == str(tmp_path)
        if request.url.path == "/session":
            return httpx.Response(200, json={"id": "session-1"})
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setenv("OPENCODE_SERVER_PASSWORD", "test")
    agent = OpenCodeAdapter(directory=tmp_path, transport=httpx.MockTransport(respond))
    client.app.dependency_overrides[get_agent] = lambda: agent
    prefix = "/api/v1/reliability"
    assert client.get(prefix + "/agent/health").json()["ready"] is True
    design = client.post(prefix + "/designs", json={"name": "Agent test"}).json()
    session = client.post(prefix + "/agent/sessions", json={
        "design_id": design["id"], "expected_revision": 1})
    assert session.status_code == 201
    assert session.json()["url"].endswith("/session/session-1")
    assert b'"noReply":true' in requests[-1].content
    assert client.post(prefix + "/agent/sessions/unknown/workflow").status_code == 404
    assert client.post(prefix + "/agent/sessions/session-1/workflow").status_code == 200
    client.put(prefix + "/designs/" + design["id"], json={
        "expected_revision": 1, "design": {"name": "changed"}})
    assert client.post(prefix + "/agent/sessions/session-1/workflow").status_code == 409

    def unavailable(request):
        raise httpx.ConnectError("private upstream failure", request=request)

    client.app.dependency_overrides[get_agent] = lambda: OpenCodeAdapter(
        transport=httpx.MockTransport(unavailable))
    status = client.get(prefix + "/agent/health").json()
    assert status["ready"] is False
    assert "private" not in str(status)
    assert client.post(prefix + "/agent/sessions", json={
        "design_id": design["id"], "expected_revision": 2}).status_code == 503


@pytest.mark.parametrize("url", ["http://user:secret@localhost", "ftp://localhost", "http://localhost?key=a"])
def test_opencode_rejects_ambiguous_or_credentialed_url(url):
    with pytest.raises(ValueError):
        OpenCodeAdapter(url=url)


@pytest.mark.asyncio
async def test_opencode_malformed_health_and_model_failure_are_not_success():
    malformed = OpenCodeAdapter(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json=[])))
    assert (await malformed.health())["ready"] is False
    failed = OpenCodeAdapter(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, json={"info": {"error": {"name": "ProviderError"}}})))
    with pytest.raises(OpenCodeUnavailable, match="模型执行失败"):
        await failed.run_workflow("session-1", "design-1")
