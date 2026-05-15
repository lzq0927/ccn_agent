#!/usr/bin/env python3
"""Debug specific problematic cases"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from agents.fault_perception.agent import FaultPerceptionAgent
from simulator.topology import TopologyGenerator
from simulator.models import KPIRecord

agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})

# Check specific cases
debug_cases = ['014', '016', '018', '020', '022', '024', '027', '031']

for case_id in debug_cases:
    case_data = load_case_data(case_id)
    if case_data is None:
        continue
    
    gt = case_data.get('ground_truth', {})
    gt_elements = gt.get('fault_elements', [])
    gt_links = gt.get('fault_links', [])
    
    print(f'\n=== Case {case_id} ===')
    print(f'GT elements: {gt_elements}')
    print(f'GT links: {gt_links[:5] if gt_links else []}')
    
    # Check KPI data for this case
    kpi_records = case_data.get('kpi_records', [])
    link_anomalies = [r for r in kpi_records if r['level'] == 'link' and r['success_rate'] < 0.95]
    print(f'Link anomalies: {len(link_anomalies)}')
    if link_anomalies:
        # Group by src
        from collections import Counter
        srcs = Counter(r['src'] for r in link_anomalies)
        print(f'Top anomaly sources: {srcs.most_common(5)}')
    
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
    print(f'Pred elements: {pred_elements}')
    print(f'Pred links: {pred_links[:3] if pred_links else []}')