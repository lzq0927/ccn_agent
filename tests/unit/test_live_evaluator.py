from agents.evaluation.live_evaluator import LiveEvaluator


class _Bus:
    def __init__(self): self.events = []
    def publish(self, type_, payload): self.events.append((type_, payload))


def test_evaluator_emits_report_and_skill_evolution():
    bus = _Bus()
    ev = LiveEvaluator(bus=bus)  # type: ignore[arg-type]
    ev.evaluate_and_emit(
        diagnosis={"fault_elements": ["UPF_1"], "confidence": 0.85, "route": "workflow"},
        truth={"elements": ["UPF_1"]},
        trace_axes={"overall": 0.9, "logicalCoherence": 0.9},
        skill={"kind": "NEW", "skill_id": "sk1", "insight": "x", "next_hit_rate": 0.9},
    )
    types = [e[0] for e in bus.events]
    assert "evaluation_report" in types
    assert "skill_evolved" in types


def test_evaluator_handles_mismatch_without_skill():
    bus = _Bus()
    ev = LiveEvaluator(bus=bus)  # type: ignore[arg-type]
    ev.evaluate_and_emit(
        diagnosis={"fault_elements": ["AMF_1"], "confidence": 0.4},
        truth={"elements": ["UPF_1"]},
        trace_axes={"overall": 0.3},
        skill=None,
    )
    types = [e[0] for e in bus.events]
    assert "evaluation_report" in types
    assert "skill_evolved" not in types
