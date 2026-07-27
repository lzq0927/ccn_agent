from agents.fault_perception.live_diagnoser import LiveDiagnoser, ReasoningStep


class _Bus:
    def __init__(self): self.events = []
    def publish(self, type_, payload): self.events.append((type_, payload))


def test_diagnoser_emits_steps_in_order():
    bus = _Bus()
    d = LiveDiagnoser(bus=bus, plugin_id="F")  # type: ignore[arg-type]

    steps = [
        ReasoningStep(n=1, type="thinking", text="initial"),
        ReasoningStep(n=2, type="tool_call", text="check kpi", result="degraded"),
        ReasoningStep(n=3, type="conclusion", text="root cause UPF_1"),
    ]
    d.stream_steps(steps, fault_elements=["UPF_1"], fault_type="single_ne", confidence=0.85)
    types = [e[0] for e in bus.events]
    assert "reasoning_step" in types
    assert "diagnosis_complete" in types
    step_payloads = [e[1] for e in bus.events if e[0] == "reasoning_step"]
    assert step_payloads[0]["n"] == 1
    assert step_payloads[2]["type"] == "conclusion"