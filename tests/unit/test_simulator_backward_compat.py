"""Ensure engine_step / live_engine changes do not break SimulationEngine.simulate()."""
from simulator.engine import SimulationEngine
from simulator.models import FaultPointType, FaultMode, Scenario
from simulator.topology import TopologyGenerator


def test_simulation_engine_simulate_unchanged():
    topo = TopologyGenerator().generate(0, seed=100)
    sc = Scenario(
        case_id=1,
        topology=topo,
        process_name="PDU_Session_Establishment",
        ue_count=20,
        fault_config=None,
        is_normal=True,
        is_train=False,
    )
    eng = SimulationEngine()
    result = eng.simulate(sc)
    assert result.kpi_records  # non-empty
    assert result.flows
