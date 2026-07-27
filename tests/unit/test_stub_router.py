from agents.simulation.stubs.router import StubRouter


def test_stub_router_loads_perception_F():
    r = StubRouter(agent="perception", scenario_id="F")
    out = r.respond(prompt="any prompt with case_id=F")
    assert "reasoning" in out
    assert isinstance(out["reasoning"], list)


def test_stub_router_loads_evaluation_F():
    r = StubRouter(agent="evaluation", scenario_id="F")
    out = r.respond(prompt="evaluate case F")
    assert "metrics" in out
    assert "trace_axes" in out


def test_stub_router_falls_back_to_ok():
    r = StubRouter(agent="perception", scenario_id="Z_NONEXIST")
    out = r.respond(prompt="x")
    assert out == {"fallback": "OK"}