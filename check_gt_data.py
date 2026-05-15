#!/usr/bin/env python3
"""Check GT data format for PATH_LINK cases"""
import sys, os
import json
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data

# Check data directory structure
data_dir = 'data'
if os.path.exists(data_dir):
    case_dirs = sorted([d for d in os.listdir(data_dir) if d.startswith('case_')])
    print(f'Found {len(case_dirs)} case directories')
    
    # Check first few
    for case_dir in case_dirs[:5]:
        case_id = case_dir.replace('case_', '')
        case_path = os.path.join(data_dir, case_dir)
        result_path = os.path.join(case_path, 'result.txt')
        
        if os.path.exists(result_path):
            with open(result_path) as f:
                gt = json.load(f)
            print(f'\n{case_dir}:')
            print(f'  fault_elements: {gt.get("fault_elements", [])}')
            print(f'  fault_links: {gt.get("fault_links", [])}')

# Also check what the simulator generates
print('\n\n=== Simulator Data Check ===')
from simulator.topology import TopologyGenerator
from simulator.scenario import ScenarioGenerator
from simulator.engine import SimulationEngine
from simulator.exporter import DataExporter

topo_gen = TopologyGenerator()
topo = topo_gen.generate(0, seed=100)
print(f'Topology elements: {list(topo.elements.keys())[:10]}')

scenario_gen = ScenarioGenerator({0: topo})
scenario = scenario_gen.generate_fault_scenario(
    fault_type='link',
    affected_element='AMF_2',
    fault_mode='link'
)
print(f'\nGenerated scenario:')
print(f'  fault_point_type: {scenario.fault_config.fault_point_type}')
print(f'  affected_ne_ids: {scenario.fault_config.affected_ne_ids}')
print(f'  affected_links: {scenario.fault_config.affected_links}')