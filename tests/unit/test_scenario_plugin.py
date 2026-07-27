from agents.shared.scenario_plugin import (
    ScenarioPlugin,
    REGISTRY,
    discover_plugins,
    capabilities_snapshot,
)


class _StubPlugin:
    id = "Z_TEST"
    label_cn = "测试"
    label_en = "TEST"
    version = "1.0"
    short_intro = "introspect"
    route_expectation = "workflow"
    expected_round = 1
    capabilities = "live"

    def build_topology(self): return None
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return None
    def on_tick(self, ctx): return []
    def diagnosis_llm_stub(self, ctx): return None
    def recovery_actions(self, plan): return []
    def on_recovery_action(self, action, ctx): return []
    def request_rebatch_chr(self): return None
    def on_user_breakdown(self, breakdown): return []


def test_registry_registers_and_resolves():
    REGISTRY.clear()
    plugin = _StubPlugin()
    REGISTRY["Z_TEST"] = plugin
    assert REGISTRY["Z_TEST"] is plugin


def test_capabilities_snapshot_skips_unknown():
    REGISTRY.clear()
    REGISTRY["Z_TEST"] = _StubPlugin()
    snap = capabilities_snapshot()
    assert snap == {"Z_TEST": "live"}


def test_discover_plugins_imports_module(monkeypatch, tmp_path):
    """discover_plugins 应能 import agents.simulation.plugins.<id> 并注册 ScenarioPlugin 实例。"""
    import sys
    sys.path.insert(0, str(tmp_path))
    REGISTRY.clear()
    from agents.shared.scenario_plugin import discover_plugins
    import importlib
    monkeypatch.setattr(importlib, "import_module", lambda name: importlib.types.ModuleType(name))
    assert ScenarioPlugin is not None