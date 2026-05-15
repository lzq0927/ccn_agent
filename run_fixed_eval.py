#!/usr/bin/env python3
"""Run fixed evaluation"""
import sys, os, json
sys.path.insert(0, '.')
from pathlib import Path

# Force reload all modules
import importlib

# Reload the fixed run_iteration
import iteration_state.iter_001.run_iteration as ri_module
importlib.reload(ri_module)

from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input, run_fault_perception, run_evaluation

case_ids = [f'{i:03d}' for i in range(1, 101)]

# Run perception
print('Running perception...')
perception_result = run_fault_perception(case_ids)
perception_results = perception_result['results']

# Run evaluation  
print('Running evaluation...')
eval_result = run_evaluation(case_ids, perception_results)

print(f'\n=== UPDATED BASELINE (fixed type logic + strict matching) ===')
print(f'Precision: {eval_result["overall_precision"]:.3f}')
print(f'Recall: {eval_result["overall_recall"]:.3f}')
print(f'F1: {eval_result["overall_f1"]:.3f}')
print(f'Correct: {eval_result["correct_count"]}/{eval_result["evaluated_count"]}')

# Save results
with open('iteration_state/iter_003/fixed_eval_result.json', 'w') as f:
    json.dump({
        'precision': eval_result["overall_precision"],
        'recall': eval_result["overall_recall"],
        'f1': eval_result["overall_f1"],
        'correct': eval_result["correct_count"],
        'evaluated': eval_result["evaluated_count"],
        'eval_results': eval_result['eval_results'][:10]  # First 10 for inspection
    }, f, indent=2)