from agents.shared import live_runner
from agents.shared.scenario_plugin import REGISTRY, discover_plugins


def test_discover_plugins_runs_at_import(monkeypatch):
    """import live_runner 应自动调一次 discover_plugins(幂等)。"""
    called = {"n": 0}
    orig = discover_plugins

    def fake():
        called["n"] += 1
        return orig()

    monkeypatch.setattr("agents.shared.scenario_plugin.discover_plugins", fake)
    import importlib
    importlib.reload(live_runner)
    assert called["n"] >= 1
    # REGISTRY 是 discover 的落点;此处仅确认它可访问且为 dict(插件本身在 T5.1 才落地)
    assert isinstance(REGISTRY, dict)


def test_import_is_idempotent_and_does_not_raise():
    """重复 reload 不应抛错(discover_plugins 幂等 + 异常被吞掉)。"""
    import importlib
    importlib.reload(live_runner)
    importlib.reload(live_runner)
    assert hasattr(live_runner, "LiveRunner")


def test_discover_failure_does_not_break_import(monkeypatch):
    """discover_plugins 抛错时 import live_runner 仍应成功。"""
    def boom():
        raise RuntimeError("boom")

    monkeypatch.setattr("agents.shared.scenario_plugin.discover_plugins", boom)
    import importlib
    importlib.reload(live_runner)
    assert hasattr(live_runner, "LiveRunner")
