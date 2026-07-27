from agents.shared.scenario_plugin import REGISTRY, discover_plugins
from agents.shared.live_runner import discover_plugins as runner_discover  # noqa: F401


def test_demo_placeholders_registered():
    REGISTRY.clear()
    discover_plugins()
    for sid in ["A", "B", "C", "D", "E"]:
        assert sid in REGISTRY, f"{sid} plugin missing"
        assert REGISTRY[sid].capabilities == "demo"


def test_demo_plugins_emit_no_tick_events():
    from agents.shared.scenario_plugin import TickContext

    for sid in ["A", "B", "C", "D", "E"]:
        p = REGISTRY[sid]
        events = p.on_tick(
            TickContext(sim_t=1, ne_cpu={}, kpi_window=[], chr_window=[], active_ue=0)
        )
        assert events == []
