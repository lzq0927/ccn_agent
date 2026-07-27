import asyncio
from agents.shared.live_runner import LiveRunner


class _Plugin:
    id = "F"
    capabilities = "live"

    def build_topology(self):
        return None

    def build_fault_config(self, topo):
        return None

    def build_ue_distribution(self):
        return None

    def on_tick(self, ctx):
        return []

    def diagnosis_llm_stub(self, ctx):
        from dataclasses import dataclass

        @dataclass
        class P:
            fault_elements: list[str]
            confidence: float
            route: str = "workflow"

        if ctx.round == 1:
            return P(fault_elements=[], confidence=0.25, route="autonomous")
        return P(fault_elements=["UPF_1"], confidence=0.6, route="workflow")

    def recovery_actions(self, plan):
        return []

    def on_recovery_action(self, action, ctx):
        return []

    def request_rebatch_chr(self):
        return None

    def on_user_breakdown(self, breakdown):
        return []


def test_runner_emits_state_sequence(tmp_path):
    seen = []

    class _Bus:
        def publish(self, type_, payload):
            seen.append((type_, payload))

    runner = LiveRunner(
        session_id="sess_001",
        scenario_id="F",
        plugin=_Plugin(),
        bus=_Bus(),  # type: ignore[arg-type]
        storage=None,
        sim_window=2,
        tick_interval=0.0,
    )
    asyncio.run(runner.run())
    states = [p[1].get("state") for p in seen if p[0] == "runner_state"]
    assert states[0] == "init"
    assert "simulating" in states
    assert "diagnosing" in states
    assert "recovering" in states
    assert "evaluating" in states
    assert states[-1] == "done"
    assert any(p[0] == "confidence_low" for p in seen)


def test_runner_continues_on_exception(tmp_path):
    class _BoomPlugin(_Plugin):
        def on_tick(self, ctx):
            raise RuntimeError("sim boom")

    seen = []

    class _Bus:
        def publish(self, type_, payload):
            seen.append((type_, payload))

    runner = LiveRunner(
        session_id="sess_002",
        scenario_id="F",
        plugin=_BoomPlugin(),
        bus=_Bus(),  # type: ignore[arg-type]
        storage=None,
        sim_window=2,
        tick_interval=0.0,
    )
    asyncio.run(runner.run())
    last_state = [p[1].get("state") for p in seen if p[0] == "runner_state"][-1]
    assert last_state == "failed"
