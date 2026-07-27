from agents.simulation.engine_step import EngineStepper, TickContext


def test_stepper_advances_clock_per_call():
    """step(dt=1) 调一次, sim_t 推进 1; 重复 3 次后 sim_t==3。"""
    st = EngineStepper(sim_window=60, base_interval=0.1)
    ctx1 = st.step(dt=1)
    ctx2 = st.step(dt=1)
    ctx3 = st.step(dt=1)
    assert ctx1.sim_t == 1
    assert ctx2.sim_t == 2
    assert ctx3.sim_t == 3


def test_stepper_emits_done_at_window_end():
    st = EngineStepper(sim_window=3, base_interval=0.0)
    st.step(dt=1)
    st.step(dt=1)
    st.step(dt=1)
    assert st.is_done() is True


def test_stepper_pause_does_not_advance():
    st = EngineStepper(sim_window=60, base_interval=0.0)
    st.pause()
    st.step(dt=1)
    assert st.sim_t == 0
    st.resume()
    st.step(dt=1)
    assert st.sim_t == 1


def test_stepper_seek_resets_clock():
    st = EngineStepper(sim_window=60, base_interval=0.0)
    for _ in range(5):
        st.step(dt=1)
    st.seek(20)
    assert st.sim_t == 20
