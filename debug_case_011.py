#!/usr/bin/env python3
"""Deep dive into specific case to understand perception output"""
import sys, os
sys.path.insert(0, '.')
from pathlib import Path

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

# Case 011: GT = SINGLE_NE (AMF_2), but perception outputs LINK
case_id = '011'
case_data = load_case_data(case_id)
gt = case_data.get('ground_truth', {})
print(f"Case {case_id}:")
print(f"  GT: {gt}")
print(f"  GT fault_elements: {gt.get('fault_elements', [])}")
print(f"  GT fault_links: {gt.get('fault_links', [])}")

perception_input = build_perception_input(case_id, case_data)

# Check anomalies
from agents.fault_perception.workflow import PerceptionWorkflow
workflow = agent.workflow

# Extract anomalies
from simulator.models import KPIRecord
kpi_records = [
    KPIRecord(
        timestamp=rec['timestamp'],
        level=rec['level'],
        ue_id=rec['ue_id'],
        src=rec['src'],
        dst=rec['dst'],
        success_rate=rec['success_rate']
    ) for rec in perception_input['kpi_records']
]

anomaly_result = workflow.extract_anomalies(kpi_records, perception_input['business_flows'])
print(f"\n  Anomalies detected: {len(anomaly_result.anomalies)}")
for a in anomaly_result.anomalies[:10]:
    print(f"    {a.level}: {a.src} -> {a.dst}, sr={a.success_rate:.3f}, dev={a.deviation:.3f}")

# Run perception
result = agent.run({
    'case_id': case_id,
    'kpi_records': perception_input['kpi_records'],
    'topology': perception_input['topology'],
    'business_flows': perception_input['business_flows']
})

output = result['output']
print(f"\n  Perception output:")
print(f"    perceived_fault_elements: {output.get('perceived_fault_elements', [])}")
print(f"    perceived_fault_links: {output.get('perceived_fault_links', [])}")
print(f"    confidence: {output.get('confidence', 0.0):.3f}")
print(f"    mode: {output.get('perception_mode', 'N/A')}")

# Check if there's a skill result
skill_result = output.get('skill_result')
if skill_result:
    print(f"\n  Skill result:")
    print(f"    fault_elements: {skill_result.fault_elements}")
    print(f"    fault_links: {skill_result.fault_links}")
    print(f"    inference_steps: {skill_result.inference_steps}")

# Now check what KPI data looks like
print(f"\n  Sample KPI records (first 20):")
for rec in perception_input['kpi_records'][:20]:
    if rec['level'] == 'link' and rec['success_rate'] < 1.0:
        print(f"    {rec['level']}: {rec['src']} -> {rec['dst']}, sr={rec['success_rate']:.3f}")

# Check the topology for AMF_2 connections
topo = perception_input['topology']
print(f"\n  Topology elements: {list(topo.elements.keys())[:20]}")
if 'AMF_2' in topo.elements:
    amf2 = topo.elements['AMF_2']
    print(f"  AMF_2: type={amf2.ne_type}, pool={amf2.pool_id}, dc={amf2.dc_id}")