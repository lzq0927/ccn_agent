#!/usr/bin/env python3
"""Analyze perception vs GT in detail"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.accuracy import AccuracyEvaluator
from simulator.topology import TopologyGenerator
from simulator.models import FaultConfig, FaultPointType, FaultMode, KPIRecord

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

# Analyze ALL fault cases
correct_cases = []
wrong_cases = []

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
    case_num_int = int(case_id)
    topo_idx = (case_num_int - 1) % 5
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
        gt_fpt = FaultPointType.PATH_LINK
    elif len(gt_elements) == 1:
        gt_fpt = FaultPointType.SINGLE_NE
    else:
        gt_fpt = FaultPointType.MULTI_NE
    
    # Determine Pred fault type (using same logic as fixed run_iteration)
    if pred_elements:
        pred_fpt = FaultPointType.SINGLE_NE if len(pred_elements) == 1 else FaultPointType.MULTI_NE
    elif pred_links:
        pred_fpt = FaultPointType.PATH_LINK
    else:
        pred_fpt = FaultPointType.NORMAL
    
    # Calculate overlap
    gt_set = set(gt_elements)
    pred_set = set(pred_elements)
    overlap = gt_set & pred_set
    overlap_pct = len(overlap) / len(gt_set) * 100 if gt_set else 0
    
    # Check if correct (type match + 70% overlap for elements, or link overlap for PATH_LINK)
    type_match = gt_fpt == pred_fpt
    
    if gt_fpt == FaultPointType.PATH_LINK:
        # For PATH_LINK, check link overlap
        gt_links_set = set(gt_links)
        pred_links_set = set()
        for link in pred_links:
            if isinstance(link, str) and '->' in link:
                parts = link.split('->')
                pred_links_set.add((parts[0], parts[1]))
            elif isinstance(link, (list, tuple)) and len(link) == 2:
                pred_links_set.add(tuple(link))
        link_overlap = len(gt_links_set & pred_links_set)
        is_correct = type_match and link_overlap > 0
    else:
        is_correct = type_match and overlap_pct >= 70
    
    if is_correct:
        correct_cases.append({
            'case': case_id,
            'gt_type': str(gt_fpt).split('.')[1],
            'gt_elements': gt_elements,
            'pred_elements': pred_elements,
            'overlap_pct': overlap_pct
        })
    else:
        # Categorize failure
        if not type_match:
            reason = f'type_mismatch'
        elif overlap_pct == 0:
            reason = 'zero_overlap'
        else:
            reason = f'partial_overlap({overlap_pct:.0f}%)'
        
        wrong_cases.append({
            'case': case_id,
            'gt_type': str(gt_fpt).split('.')[1],
            'gt_elements': gt_elements[:3],
            'pred_elements': pred_elements[:5],
            'pred_links': len(pred_links),
            'reason': reason,
            'overlap_pct': overlap_pct
        })

print(f'CORRECT: {len(correct_cases)} cases')
for c in correct_cases:
    print(f"  {c['case']}: GT={c['gt_type']}({c['gt_elements']}) Pred={c['pred_elements']} OL={c['overlap_pct']:.0f}%")

print(f'\nWRONG: {len(wrong_cases)} cases')
print(f'\nBy reason:')
from collections import Counter
reasons = Counter(w['reason'] for w in wrong_cases)
for r, count in reasons.most_common():
    print(f'  {r}: {count}')

print(f'\nFirst 15 wrong cases:')
for c in wrong_cases[:15]:
    print(f"  {c['case']}: GT={c['gt_type']}({c['gt_elements']}) Pred={c['pred_elements']} links={c['pred_links']} - {c['reason']}")