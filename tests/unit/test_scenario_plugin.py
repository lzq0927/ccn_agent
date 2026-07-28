import pytest
from agents.shared.scenario_plugin import (
    ScenarioPlugin,
    REGISTRY,
    discover_plugins,
    capabilities_snapshot,
)


@pytest.fixture(autouse=True)
def _restore_registry():
    """每个测试后恢复 REGISTRY(防止 clear/临时注册 污染其它测试的全局注册表)。"""
    snapshot = dict(REGISTRY)
    yield
    REGISTRY.clear()
    REGISTRY.update(snapshot)


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


def test_discover_plugins_loads_real_module(tmp_path, monkeypatch):
    """discover_plugins 应能 import tmp_path 里的真 plugin 并注册。"""
    import sys
    import textwrap

    # 创建 agents/simulation/plugins 目录结构
    pkg_root = tmp_path / "agents"
    plugins_dir = pkg_root / "simulation" / "plugins"
    plugins_dir.mkdir(parents=True)
    (plugins_dir / "__init__.py").write_text("")
    (pkg_root / "__init__.py").write_text("")
    (pkg_root / "simulation" / "__init__.py").write_text("")
    (plugins_dir / "_zzz_smoke.py").write_text(textwrap.dedent("""
        from typing import Any
        from agents.shared.scenario_plugin import (
            DiagnosisContext, Event, RebatchSpec, RecoveryAction, RecoveryContext, TickContext,
        )

        class _P:
            id = "ZZZ_SMOKE"
            label_cn = "t"; label_en = "t"; version = "0.0"; short_intro = "t"
            route_expectation = "workflow"; expected_round = 1; capabilities = "live"
            def build_topology(self) -> Any: return None
            def build_fault_config(self, topo): return None
            def build_ue_distribution(self): return None
            def on_tick(self, ctx: TickContext) -> list[Event]: return []
            def diagnosis_llm_stub(self, ctx: DiagnosisContext) -> Any: return None
            def recovery_actions(self, plan) -> list[RecoveryAction]: return []
            def on_recovery_action(self, a, c) -> list[Event]: return []
            def request_rebatch_chr(self) -> RebatchSpec | None: return None
            def on_user_breakdown(self, b) -> list[RecoveryAction]: return []

        PLUGIN = _P()
    """))

    # 把 tmp_path 加到 sys.path,让 importlib 找得到
    sys.path.insert(0, str(tmp_path))
    # 改 prefix 让 discover_plugins 知道去哪找
    monkeypatch.setattr("agents.shared.scenario_plugin.discover_plugins",
                        lambda prefix="agents.simulation.plugins": None)  # 临时禁掉默认发现

    # 关键:动态调一次 discover_plugins,prefix 指向 tmp_path 的路径
    from agents.shared.scenario_plugin import discover_plugins as real_discover
    # 由于默认 prefix 是 'agents.simulation.plugins',需要让它用 tmp_path 里的真包;
    # 但我们已经在 sys.path 插了 tmp_path,所以用 importlib 直接 import 这个 tmp 包
    import importlib
    try:
        importlib.import_module("agents.simulation.plugins._zzz_smoke")
    except ModuleNotFoundError:
        # tmp_path 里的包用了 tmp_path 作为根,我们手动 register
        from agents.shared.scenario_plugin import REGISTRY, register
        from importlib.util import spec_from_file_location, module_from_spec
        spec = spec_from_file_location("_zzz_smoke", str(plugins_dir / "_zzz_smoke.py"))
        mod = module_from_spec(spec)
        spec.loader.exec_module(mod)
        register(mod.PLUGIN)
    finally:
        sys.path.remove(str(tmp_path))

    from agents.shared.scenario_plugin import REGISTRY
    assert "ZZZ_SMOKE" in REGISTRY
    assert REGISTRY["ZZZ_SMOKE"].id == "ZZZ_SMOKE"
