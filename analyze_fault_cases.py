#!/usr/bin/env python3
"""Analyze fault perception vs ground truth"""
import sys, os
sys.path.insert(0, '.')
from pathlib import Path
import json

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from agents.fault_perception.agent import FaultPerceptionAgent

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

# Find first 20 cases with actual faults
fault_cases = []
for case_num in range(1, 101):
    case_id = f'{case_num:03d}'
    case_data = load_case_data(case_id)
    if case_data is None:
        continue
    gt = case_data.get('ground_truth', {})
    gt_elements = gt.get('fault_elements', [])
    gt_links = gt.get('fault_links', [])
    if gt_elements or gt_links:
        fault_cases.append(case_id)
        if len(fault_cases) >= 20:
            break

print(f'Found {len(fault_cases)} fault cases: {fault_cases}')
print()

correct = 0
total = 0
type_mismatch = 0
zero_overlap = 0
partial_overlap = 0

for case_id in fault_cases:
    case_data = load_case_data(case_id)
    gt = case_data.get('ground_truth', {})
    gt_elements = gt.get('fault_elements', [])
    gt_links = gt.get('fault_links', [])
    
    perception_input = build_perception_input(case_id, case_data)
    result = agent.run({
        'case_id': case_id,
        'kpi_records': perception_input['kpi_records'],
        'topology': perception_input['topology'],
        'business_flows': perception_input['business_flows']
    })
    
    output = result['output']
    pred_elements = output.get('perceived_fault_elements', [])
    pred_links = output.get('perceived_fault_links', [])
    confidence = output.get('confidence', 0.0)
    
    # Determine GT fault type
    if gt_links:
        fpt = f'LINK({len(gt_links)})'
    elif len(gt_elements) == 1:
        fpt = 'SINGLE'
    elif len(gt_elements) > 1:
        fpt = f'MULTI({len(gt_elements)})'
    else:
        fpt = 'NORMAL'
    
    # Determine Pred fault type
    if pred_links:
        pred_fpt = f'LINK({len(pred_links)})'
    elif len(pred_elements) == 1:
        pred_fpt = 'SINGLE'
    elif len(pred_elements) > 1:
        pred_fpt = f'MULTI({len(pred_elements)})'
    else:
        pred_fpt = 'NONE'
    
    overlap = set(gt_elements) & set(pred_elements)
    overlap_pct = len(overlap) / len(gt_elements) * 100 if gt_elements else 0
    
    status = 'OK' if (overlap_pct >= 70 and fpt == pred_fpt) else 'FAIL'
    if status == 'OK':
        correct += 1
    total += 1
    
    if fpt != pred_fpt:
        type_mismatch += 1
    elif overlap_pct == 0:
        zero_overlap += 1
    elif overlap_pct < 70:
        partial_overlap += 1
    
    print(f'{case_id}: GT={fpt}({gt_elements[:3]}) Pred={pred_fpt}({pred_elements[:3]}) OL={overlap_pct:.0f}% [{status}]')

print()
print(f'Summary: {correct}/{total} correct')
print(f'  Type mismatch: {type_mismatch}')
print(f'  Zero overlap: {zero_overlap}')
print(f'  Partial overlap (<70%): {partial_overlap}')