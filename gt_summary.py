#!/usr/bin/env python3
"""Summary analysis of all failure categories"""
import sys, os
sys.path.insert(0, '.')

import importlib
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data
from simulator.topology import TopologyGenerator
from simulator.models import FaultPointType

# Load all GT data
gt_summary = {
    'normal': [],
    'single_ne': [],
    'multi_ne': [],
    'path_link': []
}

for case_num in range(1, 101):
    case_id = f'{case_num:03d}'
    case_path = f'data/case_{case_id}/result.txt'
    if not os.path.exists(case_path):
        continue
    
    import json
    with open(case_path) as f:
        gt = json.load(f)
    
    elements = gt.get('fault_elements', [])
    links = gt.get('fault_links', [])
    
    if not elements and not links:
        gt_summary['normal'].append(case_id)
    elif links:
        gt_summary['path_link'].append((case_id, len(links), links[0] if links else ''))
    elif len(elements) == 1:
        gt_summary['single_ne'].append((case_id, elements[0]))
    else:
        gt_summary['multi_ne'].append((case_id, len(elements), elements[:3]))

print('=== GT Data Summary ===')
print(f'Normal: {len(gt_summary["normal"])} cases')
print(f'SINGLE_NE: {len(gt_summary["single_ne"])} cases')
print(f'MULTI_NE: {len(gt_summary["multi_ne"])} cases')
print(f'PATH_LINK: {len(gt_summary["path_link"])} cases')

print('\n=== SINGLE_NE breakdown ===')
from collections import Counter
ne_types = Counter()
for case_id, elem in gt_summary['single_ne']:
    ne_types[elem.split('_')[0]] += 1
print(f'By NE type: {dict(ne_types)}')

print('\n=== PATH_LINK breakdown ===')
link_counts = Counter()
for case_id, count, first_link in gt_summary['path_link']:
    link_counts[count] += 1
print(f'By link count: {dict(sorted(link_counts.items()))}')

# Check: for PATH_LINK, how many unique sources?
path_link_sources = Counter()
for case_id, count, first_link in gt_summary['path_link']:
    if first_link:
        src = first_link.split('->')[0]
        path_link_sources[src.split('_')[0]] += 1
print(f'PATH_LINK by source type: {dict(path_link_sources)}')