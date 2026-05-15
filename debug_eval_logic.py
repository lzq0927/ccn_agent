#!/usr/bin/env python3
"""Debug the evaluation logic"""
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

# Check cases
for case_id in ['013', '017', '011']:
    topo_idx = (int(case_id) - 1) % 5
    topo_gen = TopologyGenerator()
    topology = topo_gen.generate(topo_idx, seed=100 + topo_idx)
    evaluator = AccuracyEvaluator(topology)
    
    case_data = load_case_data(case_id)
    gt = parse_fault_config_from_result(case_data['ground_truth'], topology)
    perception_input = build_perception_input(case_id, case_data)
    result = agent.run({
        'case_id': case_id,
        'kpi_records': perception_input['kpi_records'],
        'topology': perception_input['topology'],
        'business_flows': perception_input['business_flows']
    })
    
    output = result.get('output', {})
    perceived_elements = output.get('perceived_fault_elements', [])
    
    # Determine pred type from perceived_elements (same logic as run_evaluation)
    if len(perceived_elements) == 1:
        pred_type = FaultPointType.SINGLE_NE
    elif len(perceived_elements) > 1:
        pred_type = FaultPointType.MULTI_NE
    else:
        pred_type = FaultPointType.PATH_LINK
    
    pred = FaultConfig(
        fault_point_type=pred_type,
        fault_mode=FaultMode.LINK,
        loss_rate=0.05,
        fault_start=20,
        fault_duration=15,
        affected_ne_ids=set(perceived_elements),
        affected_links=[]
    )
    
    print(f'Case {case_id}:')
    print(f'  GT type: {gt.fault_point_type.value}, GT elements: {len(gt.affected_ne_ids)}')
    print(f'  Pred elements: {perceived_elements}')
    print(f'  Overlap: {len(set(perceived_elements) & gt.affected_ne_ids)}')
    print(f'  Match: {evaluator._matches_ground_truth(pred, gt)}')
    print()