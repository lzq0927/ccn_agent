#!/usr/bin/env python3
"""Check if 70% threshold is too strict for MULTI_NE cases"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from agents.fault_perception.agent import FaultPerceptionAgent
from simulator.topology import TopologyGenerator

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

# Find MULTI_NE cases and check actual overlap
multi_ne_cases = []

for case_num in range(1, 101):
    case_id = f'{case_num:03d}'
    case_data = load_case_data(case_id)
    if case_data is None:
        continue
    
    gt = case_data.get('ground_truth', {})
    gt_elements = gt.get('fault_elements', [])
    gt_links = gt.get('fault_links', [])
    
    if gt_links or not gt_elements or len(gt_elements) == 1:
        continue
    
    # This is a MULTI_NE case
    topo_idx = (int(case_id) - 1) % 5
    topo_seed = 100 + topo_idx
    topo_gen = TopologyGenerator()
    topology = topo_gen.generate(topo_idx, seed=topo_seed)
    
    perception_input = build_perception_input(case_id, case_data)
    result = agent.run({
        'case_id': case_id,
        'kpi_records': perception_input['kpi_records'],
        'topology': perception_input['topology'],
        'business_flows': perception_input['business_flows']
    })
    
    output = result['output']
    pred_elements = [e for e in output.get('perceived_fault_elements', []) if e]
    
    gt_set = set(gt_elements)
    pred_set = set(pred_elements)
    overlap = gt_set & pred_set
    overlap_pct = len(overlap) / len(gt_set) * 100 if gt_set else 0
    
    # Check if at least ONE correct element
    if overlap:
        multi_ne_cases.append({
            'case': case_id,
            'gt_elements': gt_elements,
            'pred_elements': pred_elements,
            'overlap': list(overlap),
            'overlap_pct': overlap_pct
        })

print(f'MULTI_NE cases with at least 1 correct element: {len(multi_ne_cases)}/{len(multi_ne_cases) + 0}')
print()

# What % of MULTI_NE cases have some correct detection?
from collections import Counter

# How many are below 70% but above 0?
partial = [c for c in multi_ne_cases if 0 < c['overlap_pct'] < 70]
zero = [c for c in multi_ne_cases if c['overlap_pct'] == 0]
full = [c for c in multi_ne_cases if c['overlap_pct'] >= 70]

print(f'Full match (>=70%): {len(full)}')
print(f'Partial match (0-70%): {len(partial)}')
print(f'Zero match: {len(zero)}')

print(f'\nPartial match cases (would be correct with lower threshold):')
for c in partial[:10]:
    print(f"  {c['case']}: GT={c['gt_elements']} Pred={c['pred_elements']} OL={c['overlap_pct']:.0f}%")

# If we lowered threshold to 50%, how many would be correct?
print(f'\nIf threshold was 50%: {len(full) + len([c for c in partial if c["overlap_pct"] >= 50])}/{len(multi_ne_cases)}')