"""LiveRunner 活跃 session 限流测试。"""
from agents.shared.live_runner import LiveRunner, RunnerRegistry


def test_registry_rejects_overflow():
    reg = RunnerRegistry(max_active=2)
    reg.add("s1")
    reg.add("s2")
    try:
        reg.add("s3")
    except RuntimeError as e:
        assert "active sessions" in str(e).lower()
    else:
        raise AssertionError("expected RuntimeError")


def test_registry_releases_on_remove():
    reg = RunnerRegistry(max_active=2)
    reg.add("s1")
    reg.add("s2")
    reg.remove("s1")
    reg.add("s3")  # 不应抛
    assert reg.size() == 2
