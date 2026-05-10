"""
核心网可靠性离散事件仿真系统 - 主入口

Pipeline:
1. 场景生成 (Scenario Generation)
2. 仿真执行 (Simulation)
3. 数据导出 (Data Export)
"""
import os
import sys
import random
import time

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from simulator.topology import TopologyGenerator
from simulator.scenario import ScenarioGenerator
from simulator.engine import SimulationEngine
from simulator.exporter import DataExporter


def main():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data_dir = os.path.join(base_dir, "data")
    os.makedirs(data_dir, exist_ok=True)

    print("=" * 60)
    print("核心网可靠性离散事件仿真系统")
    print("=" * 60)

    # ---- Stage 1: 场景生成 ----
    print("\n[Stage 1] 场景生成...")

    # 生成5种拓扑
    topo_gen = TopologyGenerator()
    topologies = {}
    for i in range(5):
        topologies[i] = topo_gen.generate(i, seed=100 + i)
        ne_count = len(topologies[i].elements)
        pool_count = len(topologies[i].get_pool_ids())
        dc_count = len(topologies[i].get_dc_ids())
        print(f"  Topology {i}: {dc_count} DC, {pool_count} pools, {ne_count} NEs")

    # 生成100个测试场景
    scenario_gen = ScenarioGenerator(topologies)
    scenarios = scenario_gen.generate(num_cases=100, seed=42)

    normal_count = sum(1 for s in scenarios if s.is_normal)
    train_count = sum(1 for s in scenarios if s.is_train)
    test_count = len(scenarios) - train_count
    print(f"  Generated {len(scenarios)} scenarios: "
          f"{normal_count} normal, {train_count} train, {test_count} test")

    # ---- Stage 2: 仿真执行 ----
    print(f"\n[Stage 2] 仿真执行 ({len(scenarios)} cases)...")

    engine = SimulationEngine()
    results = []

    start_time = time.time()
    for idx, scenario in enumerate(scenarios):
        result = engine.simulate(scenario)
        results.append(result)

        if (idx + 1) % 20 == 0 or idx == 0:
            elapsed = time.time() - start_time
            kpi_count = len(result.kpi_records)
            print(f"  Case {idx + 1}/{len(scenarios)}: "
                  f"{scenario.ue_count} UEs, {kpi_count} KPI records "
                  f"({elapsed:.1f}s elapsed)")

    total_time = time.time() - start_time
    print(f"  Simulation complete: {total_time:.1f}s")

    # ---- Stage 3: 数据导出 ----
    print(f"\n[Stage 3] 数据导出...")

    exporter = DataExporter(data_dir)

    for idx, (scenario, result) in enumerate(zip(scenarios, results)):
        exporter.export(scenario, result)

        if (idx + 1) % 20 == 0:
            print(f"  Exported {idx + 1}/{len(scenarios)} cases")

    # Write split info
    exporter.write_split_info(scenarios)

    print(f"\n  All data exported to: {data_dir}")

    # Print summary
    print("\n" + "=" * 60)
    print("Summary:")
    print(f"  Total cases:  {len(scenarios)}")
    print(f"  Normal cases: {normal_count}")
    print(f"  Fault cases:  {len(scenarios) - normal_count}")
    print(f"  Train set:    {train_count}")
    print(f"  Test set:     {test_count}")
    print("=" * 60)


if __name__ == "__main__":
    main()
