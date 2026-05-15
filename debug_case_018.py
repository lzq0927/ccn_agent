#!/usr/bin/env python3
"""Deep analysis of PATH_LINK case 018"""
import sys, os
import json
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
from simulator.topology import TopologyGenerator
from simulator.models import KPIRecord, BusinessFlow

# Case 018: GT has 5 links all FROM AMF_2
case_id = '018'
case_data = load_case_data(case_id)
gt = case_data.get('ground_truth', {})

print(f'=== Case {case_id} ===')
print(f'GT fault_elements: {gt.get("fault_elements", [])}')
print(f'GT fault_links: {gt.get("fault_links", [])}')
print()

# Get topology
topo_idx = (int(case_id) - 1) % 5
topo_seed = 100 + topo_idx
topo_gen = TopologyGenerator()
topology = topo_gen.generate(topo_idx, seed=topo_seed)

# Parse KPIs
kpi_records = case_data.get('kpi_records', [])
link_records = [r for r in kpi_records if r['level'] == 'link' and r['success_rate'] < 0.95]

print(f'Total link anomalies: {len(link_records)}')

# Group by source
from collections import defaultdict, Counter
src_counts = Counter(r['src'] for r in link_records)
print(f'\nAnomaly sources (by count):')
for src, count in src_counts.most_common(10):
    print(f'  {src}: {count} anomalies')

# Check GT links: what are the actual GT link endpoints?
gt_links = gt.get('fault_links', [])
print(f'\nGT links analysis:')
gt_srcs = Counter()
gt_dsts = Counter()
for link in gt_links:
    parts = link.split('->')
    if len(parts) == 2:
        gt_srcs[parts[0]] += 1
        gt_dsts[parts[1]] += 1
print(f'  GT sources: {dict(gt_srcs)}')
print(f'  GT destinations: {dict(gt_dsts)}')

# What does perception output?
perception_input = build_perception_input(case_id, case_data)
from agents.fault_perception.agent import FaultPerceptionAgent
agent = FaultPerceptionAgent(config={
    'confidence_threshold_high': 0.30,
    'confidence_threshold_medium': 0.15,
    'enable_self_optimization': False,
    'historical_cases': []
})
result = agent.run({
    'case_id': case_id,
    'kpi_records': perception_input['kpi_records'],
    'topology': perception_input['topology'],
    'business_flows': perception_input['business_flows']
})
output = result['output']
print(f'\nPerception output:')
print(f'  perceived_fault_elements: {output.get("perceived_fault_elements", [])}')
print(f'  perceived_fault_links: {output.get("perceived_fault_links", [])}')

# Check: GT has links from AMF_2 to MULTIPLE targets
# The GT says these links are faulty
# The perception finds AMF_2 as the source with highest anomaly count
# But it only finds links to SMF_1, SMF_6, gNB_11 - not the GT links

# Check KPI for AMF_2 -> AMF_4 specifically
amf2_amf4 = [r for r in kpi_records 
             if r['level'] == 'link' 
             and r['src'] == 'AMF_2' 
             and r['dst'] == 'AMF_4']
print(f'\nAMF_2->AMF_4 KPI records:')
if amf2_amf4:
    for r in amf2_amf4[:5]:
        print(f'  ts={r["timestamp"]}, sr={r["success_rate"]:.3f}')
else:
    print('  (no records found)')

# Check if AMF_4 exists in topology
print(f'\nTopology check:')
print(f'  AMF_2 in topology: {"AMF_2" in topology.elements}')
print(f'  AMF_4 in topology: {"AMF_4" in topology.elements}')
print(f'  SMF_1 in topology: {"SMF_1" in topology.elements}')