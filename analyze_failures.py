#!/usr/bin/env python3
"""Analyze remaining failures after semantic bridge fix"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from agents.fault_perception.agent import FaultPerceptionAgent
from simulator.topology import TopologyGenerator
from simulator.models import FaultPointType

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

# Analyze ALL fault cases with new logic
correct = []
wrong = []

for case_num in range(1, 101):
    case_id = f'{case_num:03d}'
    case_data = load_case_data(case_id)
    if case_data is None:
        continue
    
    gt = case_data.get('ground_truth', {})
    gt_elements = gt.get('fault_elements', [])
    gt_links = gt.get('fault_links', [])
    
    if not gt_elements and not gt_links:
        continue  # Skip normal cases
    
    # Get topology
    topo_idx = (int(case_id) - 1) % 5
    topo_seed = 100 + topo_idx
    topo_gen = TopologyGenerator()
    topology = topo_gen.generate(topo_idx, seed=topo_seed)
    
    # Run perception
    perception_input = build_perception_input(case_id, case_data)
    result = agent.run({
        'case_id': case_id,
        'kpi_records': perception_input['kpi_records'],
        'topology': perception_input['topology'],
        'business_flows': perception_input['business_flows']
    })
    
    output = result['output']
    pred_elements = [e for e in output.get('perceived_fault_elements', []) if e]
    pred_links = output.get('perceived_fault_links', [])
    
    # Determine GT fault type
    if gt_links:
        gt_fpt = 'PATH_LINK'
    elif len(gt_elements) == 1:
        gt_fpt = 'SINGLE_NE'
    else:
        gt_fpt = 'MULTI_NE'
    
    # Determine Pred fault type (using same logic as fixed run_iteration)
    if pred_elements:
        pred_fpt = 'SINGLE_NE' if len(pred_elements) == 1 else 'MULTI_NE'
    elif pred_links:
        pred_fpt = 'PATH_LINK'
    else:
        pred_fpt = 'NORMAL'
    
    # Calculate overlap for elements
    gt_set = set(gt_elements)
    pred_set = set(pred_elements)
    overlap = gt_set & pred_set
    overlap_pct = len(overlap) / len(gt_set) * 100 if gt_set else 0
    
    # Check semantic bridge for PATH_LINK
    matched = False
    if gt_fpt == 'PATH_LINK' and pred_fpt in ('SINGLE_NE', 'MULTI_NE'):
        # Extract link sources
        gt_link_sources = set()
        for link in gt_links:
            if '->' in link:
                src = link.split('->')[0]
                gt_link_sources.add(src)
        if gt_link_sources & pred_set:
            matched = True
    elif gt_fpt == pred_fpt:
        if gt_fpt in ('SINGLE_NE', 'MULTI_NE'):
            matched = overlap_pct >= 70
        elif gt_fpt == 'PATH_LINK':
            matched = True  # Already handled above
    
    if matched:
        correct.append(case_id)
    else:
        wrong.append({
            'case': case_id,
            'gt_type': gt_fpt,
            'gt_elements': gt_elements[:3],
            'gt_links': len(gt_links),
            'pred_type': pred_fpt,
            'pred_elements': pred_elements[:5],
            'pred_links': len(pred_links),
        })

print(f'Correct: {len(correct)}')
print(f'Wrong: {len(wrong)}')

# Analyze wrong cases
from collections import Counter
gt_types = Counter(w['gt_type'] for w in wrong)
print(f'\nWrong by GT type: {dict(gt_types)}')

pred_types = Counter(w['pred_type'] for w in wrong)
print(f'Wrong by Pred type: {dict(pred_types)}')

# Breakdown by category
print('\n=== Wrong cases by category ===')
for w in wrong:
    print(f"  {w['case']}: GT={w['gt_type']}({w['gt_elements'][:2]}) Pred={w['pred_type']}({w['pred_elements'][:2]})")

# Check for zero overlap (pred elements not in GT at all)
print('\n=== Zero overlap cases (pred elements completely wrong) ===')
zero_overlap = []
for w in wrong:
    gt_set = set(w['gt_elements'])
    pred_set = set(w['pred_elements'])
    if gt_set and pred_set and not (gt_set & pred_set):
        zero_overlap.append(w)

print(f'Zero overlap: {len(zero_overlap)} cases')
for w in zero_overlap[:10]:
    print(f"  {w['case']}: GT={w['gt_elements']} Pred={w['pred_elements']}")