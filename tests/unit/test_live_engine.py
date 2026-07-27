from agents.simulation.engine_step import EngineStepper
from agents.simulation.live_engine import LiveEngine, UeRequest, UeResponse


class _CountingPlugin:
    id = "X"
    capabilities = "live"

    def __init__(self):
        self.ticks = 0
        self.ue_responses: list[UeResponse] = []

    def build_topology(self): return None
    def build_fault_config(self, topo): return None
    def build_ue_distribution(self): return None
    def on_tick(self, ctx): self.ticks += 1; return []
    def diagnosis_llm_stub(self, ctx): return None
    def recovery_actions(self, plan): return []
    def on_recovery_action(self, action, ctx): return []
    def request_rebatch_chr(self): return None
    def on_user_breakdown(self, breakdown): return []

    def on_ue_request(self, req: UeRequest) -> UeResponse:
        self.ue_responses.append(UeResponse("ALLOW"))
        return UeResponse("ALLOW")


def test_live_engine_calls_on_tick_each_step():
    plugin = _CountingPlugin()
    st = EngineStepper(sim_window=3, base_interval=0.0)
    le = LiveEngine(stepper=st, plugin=plugin)
    le.run_sync()  # 同步跑完 3 tick
    assert plugin.ticks == 3
    assert st.is_done() is True


def test_live_engine_admits_ue_through_plugin():
    plugin = _CountingPlugin()
    st = EngineStepper(sim_window=2, base_interval=0.0)
    le = LiveEngine(stepper=st, plugin=plugin)
    le.run_sync()
    resp = le.admit_ue_request(UeRequest(ue_id="u1", kind="registration", sim_t=1))
    assert resp.verdict == "ALLOW"
    assert plugin.ue_responses[0].verdict == "ALLOW"
