#!/usr/bin/env python3
"""Check UE fault case 012 in detail"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from simulator.topology import TopologyGenerator

case_id = '012'
case_data = load_case_data(case_id)
gt = case_data.get('ground_truth', {})

print(f'=== Case {case_id} ===')
print(f'GT: {gt}')

# Get KPIs
kpi_records = case_data.get('kpi_records', [])

# Group by level
from collections import Counter
levels = Counter(r['level'] for r in kpi_records)
print(f'\nKPI levels: {dict(levels)}')

# Check session level records
session_records = [r for r in kpi_records if r['level'] == 'session']
print(f'\nSession records: {len(session_records)}')
if session_records:
    print(f'First 5: {session_records[:5]}')

# Check link level for UE
ue_link = [r for r in kpi_records if 'UE' in r.get('src', '') or 'UE' in r.get('dst', '')]
print(f'\nUE-related link records: {len(ue_link)}')

# Check topology
topo_idx = (int(case_id) - 1) % 5
topo_seed = 100 + topo_idx
topo_gen = TopologyGenerator()
topology = topo_gen.generate(topo_idx, seed=topo_seed)

print(f'\nTopology elements with UE: {[e for e in topology.elements.keys() if "UE" in e]}')
print(f'Total elements: {len(topology.elements)}')

# What does perception see?
perception_input = build_perception_input(case_id, case_data)
print(f'\nBusiness flows: {len(perception_input["business_flows"])}')
for flow in perception_input['business_flows'][:3]:
    print(f'  UE={flow.ue_id}, hops={flow.hops[:3]}')