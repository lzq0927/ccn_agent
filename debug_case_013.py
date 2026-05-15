#!/usr/bin/env python3
"""Debug Case 013 evaluation step by step"""
import sys
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input, parse_fault_config_from_result
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.accuracy import AccuracyEvaluator
from simulator.topology import TopologyGenerator
from simulator.models import FaultConfig, FaultPointType, FaultMode

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

case_id = '013'
topo_idx = (int(case_id) - 1) % 5
topo_gen = TopologyGenerator()
topology = topo_gen.generate(topo_idx, seed=100 + topo_idx)
evaluator = AccuracyEvaluator(topology)

case_data = load_case_data(case_id)
gt = parse_fault_config_from_result(case_data['ground_truth'], topology)

print(f'GT fault_point_type: {gt.fault_point_type}')
print(f'GT affected_ne_ids count: {len(gt.affected_ne_ids)}')
print(f'GT is in MULTI_ELEMENT_TYPES: {gt.fault_point_type in evaluator.MULTI_ELEMENT_TYPES}')
print()

# Check the actual _matches_ground_truth logic
perception_input = build_perception_input(case_id, case_data)
result = agent.run({
    'case_id': case_id,
    'kpi_records': perception_input['kpi_records'],
    'topology': perception_input['topology'],
    'business_flows': perception_input['business_flows']
})

output = result.get('output', {})
perceived_elements = output.get('perceived_fault_elements', [])

pred_type = FaultPointType.MULTI_NE if len(perceived_elements) > 1 else (FaultPointType.SINGLE_NE if len(perceived_elements) == 1 else FaultPointType.PATH_LINK)

pred = FaultConfig(
    fault_point_type=pred_type,
    fault_mode=FaultMode.LINK,
    loss_rate=0.0,
    fault_start=0,
    fault_duration=0,
    affected_ne_ids=set(perceived_elements),
    affected_links=[]
)

print(f'Pred fault_point_type: {pred.fault_point_type}')
print(f'Pred affected_ne_ids: {perceived_elements}')
print(f'Pred is in MULTI_ELEMENT_TYPES: {pred.fault_point_type in evaluator.MULTI_ELEMENT_TYPES}')
print()

# Step through the matching logic
gt_fpt = gt.fault_point_type
pred_fpt = pred.fault_point_type

print('=== Step-by-step matching ===')
print(f'1. gt_fpt = {gt_fpt}')
print(f'2. pred_fpt = {pred_fpt}')
print(f'3. gt_fpt == PATH_LINK: {gt_fpt == FaultPointType.PATH_LINK}')
print(f'4. pred_fpt in (SINGLE_NE, MULTI_NE): {pred_fpt in (FaultPointType.SINGLE_NE, FaultPointType.MULTI_NE)}')
print()

# Multi-element check
gt_is_multi = gt_fpt in evaluator.MULTI_ELEMENT_TYPES
pred_is_multi = pred_fpt in evaluator.MULTI_ELEMENT_TYPES
print(f'5. gt_is_multi_element: {gt_is_multi}')
print(f'6. pred_is_multi_element: {pred_is_multi}')
print(f'7. Both multi? {gt_is_multi and pred_is_multi}')
print(f'8. One multi one not? {gt_is_multi != pred_is_multi}')
print()

# Check final matching
if gt_is_multi and pred_is_multi:
    print('Both multi-element, continuing to overlap check...')
    
    gt_elements = set(gt.affected_ne_ids)
    pred_elements = set(pred.affected_ne_ids)
    overlap = pred_elements & gt_elements
    overlap_ratio = len(overlap) / len(gt_elements) if gt_elements else 0
    
    gt_size = len(gt_elements)
    if gt_size <= 5:
        threshold = 0.7
    elif gt_size <= 10:
        threshold = 0.6
    else:
        threshold = 0.5
    
    print(f'   gt_elements: {len(gt_elements)}')
    print(f'   pred_elements: {len(pred_elements)}')
    print(f'   overlap: {len(overlap)}')
    print(f'   overlap_ratio: {overlap_ratio:.2%}')
    print(f'   threshold: {threshold}')
    print(f'   Pass? {overlap_ratio >= threshold}')
else:
    print('Type mismatch, returning False')