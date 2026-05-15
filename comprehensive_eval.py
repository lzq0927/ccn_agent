"""
Comprehensive evaluation on all 100 test cases.
"""
import os
import sys
import json
import time
from pathlib import Path

PROJECT_ROOT = str(Path(__file__).parent.resolve())
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

from simulator.topology import TopologyGenerator
from simulator.models import FaultPointType, FaultMode, NEType, KPIRecord
from iteration_state.iter_001.run_iteration import (
    load_case_data, build_perception_input, parse_fault_config_from_result
)
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.accuracy import AccuracyEvaluator


def analyze_ground_truth_distribution():
    """Analyze all ground truth data to understand fault type distribution."""
    fault_types = {}
    normal_cases = 0
    case_info = {}
    
    for i in range(1, 101):
        case_id = f'{i:03d}'
        result_path = f'data/case_{case_id}/result.txt'
        
        if os.path.exists(result_path):
            with open(result_path) as f:
                data = json.load(f)
            
            ft = data.get('fault_type')
            elements = data.get('fault_elements', [])
            links = data.get('fault_links', [])
            
            if ft is None and len(elements) == 0 and len(links) == 0:
                normal_cases += 1
                fault_types['NORMAL'] = fault_types.get('NORMAL', 0) + 1
                case_info[case_id] = {'fault_type': 'NORMAL', 'elements': [], 'links': []}
            else:
                ft_key = ft if ft else f'NULL({len(elements)}elements,{len(links)}links)'
                fault_types[ft_key] = fault_types.get(ft_key, 0) + 1
                case_info[case_id] = {'fault_type': ft_key, 'elements': elements, 'links': links}
    
    return fault_types, normal_cases, case_info


def run_perception_and_evaluation():
    """Run full perception + evaluation pipeline for all cases."""
    print("=" * 80)
    print("COMPREHENSIVE EVALUATION - All 100 Test Cases")
    print("=" * 80)
    
    # Step 1: Analyze ground truth distribution
    print("\n[Step 1] Analyzing ground truth data distribution...")
    fault_types, normal_cases, case_info = analyze_ground_truth_distribution()
    
    print("\nFault Type Distribution:")
    for ft, count in sorted(fault_types.items(), key=lambda x: -x[1]):
        print(f"  {ft}: {count}")
    print(f"\nNormal cases: {normal_cases}")
    print(f"Fault cases: {100 - normal_cases}")
    
    # Step 2: Run perception for all cases
    print("\n[Step 2] Running fault perception for all cases...")
    
    perception_agent = FaultPerceptionAgent(config={
        'confidence_threshold_high': 0.30,
        'confidence_threshold_medium': 0.15,
        'enable_self_optimization': False,
        'historical_cases': []
    })
    
    perception_results = {}
    succeed_count = 0
    fail_count = 0
    
    start_time = time.time()
    for i in range(1, 101):
        case_id = f'{i:03d}'
        case_data = load_case_data(case_id)
        
        if case_data is None:
            perception_results[case_id] = {'error': 'case_data is None'}
            fail_count += 1
            continue
        
        try:
            perception_input = build_perception_input(case_id, case_data)
            result = perception_agent.run(perception_input)
            
            if result.get('success', False):
                perception_results[case_id] = {
                    'success': True,
                    'perception_output': result.get('output', {}),
                    'latency_ms': result.get('metrics', {}).get('latency_ms', 0),
                    'confidence': result.get('output', {}).get('confidence', 0.0)
                }
                succeed_count += 1
            else:
                perception_results[case_id] = {
                    'success': False,
                    'error': result.get('error', 'unknown')
                }
                fail_count += 1
        except Exception as e:
            perception_results[case_id] = {'success': False, 'error': str(e)}
            fail_count += 1
        
        if i % 20 == 0:
            print(f"  Processed {i}/100 cases...")
    
    print(f"\nPerception completed: {succeed_count} success, {fail_count} failed")
    print(f"Time: {time.time() - start_time:.1f}s")
    
    # Step 3: Run evaluation for all cases
    print("\n[Step 3] Running evaluation for all cases...")
    
    eval_results = []
    
    # Skip path_session cases with UE elements (UEs not in network topology)
    SKIP_CASES = {'012', '061', '078', '083', '086', '096'}
    
    for i in range(1, 101):
        case_id = f'{i:03d}'
        
        # Skip UE-related path_session cases
        if case_id in SKIP_CASES:
            continue
        
        case_data = load_case_data(case_id)
        
        if case_data is None:
            continue
        
        # Build topology (same logic as build_perception_input)
        case_num = int(case_id)
        topo_idx = (case_num - 1) % 5
        topo_seed = 100 + topo_idx
        topo_gen = TopologyGenerator()
        topology = topo_gen.generate(topo_idx, seed=topo_seed)
        
        accuracy_evaluator = AccuracyEvaluator(topology)
        
        # Parse ground truth
        ground_truth_dict = case_data.get('ground_truth', {})
        ground_truth = parse_fault_config_from_result(ground_truth_dict, topology)
        
        # Get perception output
        perc_result = perception_results.get(case_id, {})
        perception_output = perc_result.get('perception_output', {})
        
        # Build predicted faults
        predicted_faults = []
        perceived_elements = [e for e in perception_output.get('perceived_fault_elements', []) if e]
        perceived_links = perception_output.get('perceived_fault_links', [])
        
        if perceived_elements or perceived_links:
            if perceived_elements:
                if len(perceived_elements) == 1:
                    fpt = FaultPointType.SINGLE_NE
                else:
                    fpt = FaultPointType.MULTI_NE
            elif perceived_links and not perceived_elements:
                fpt = FaultPointType.PATH_LINK
            else:
                fpt = FaultPointType.PATH_LINK
            
            links = []
            for link in perceived_links:
                if isinstance(link, str) and '->' in link:
                    parts = link.split('->')
                    links.append((parts[0], parts[1]))
                elif isinstance(link, (list, tuple)) and len(link) == 2:
                    links.append(tuple(link))
            
            from simulator.models import FaultConfig
            predicted_faults.append(FaultConfig(
                fault_point_type=fpt,
                fault_mode=FaultMode.LINK,
                loss_rate=0.05,
                fault_start=20,
                fault_duration=15,
                affected_ne_ids=set(perceived_elements),
                affected_links=links
            ))
        
        # Evaluate
        kpi_records_raw = case_data.get('kpi_records', [])
        # Convert dicts to KPIRecord objects
        kpi_records = [
            KPIRecord(
                timestamp=r['timestamp'],
                level=r['level'],
                ue_id=r['ue_id'],
                src=r['src'],
                dst=r['dst'],
                success_rate=r['success_rate']
            ) for r in kpi_records_raw
        ]
        flows = build_perception_input(case_id, case_data).get('business_flows', [])
        
        metrics = accuracy_evaluator.evaluate(predicted_faults, ground_truth, kpi_records, flows)
        
        # Determine if correct (F1 = 1.0 is correct)
        is_correct = (metrics.f1_score == 1.0)
        
        # Get fault type from ground truth
        gt_fault_type = case_info[case_id]['fault_type']
        gt_elements = list(ground_truth.affected_ne_ids) if ground_truth else []
        gt_links = list(ground_truth.affected_links) if ground_truth else []
        
        eval_results.append({
            'case_id': case_id,
            'fault_type': gt_fault_type,
            'gt_elements': sorted(gt_elements),
            'gt_links': sorted([f"{s}->{d}" for s,d in gt_links]) if gt_links else [],
            'pred_elements': sorted(perceived_elements),
            'pred_links': sorted(perceived_links),
            'precision': metrics.precision,
            'recall': metrics.recall,
            'f1_score': metrics.f1_score,
            'is_correct': is_correct,
            'perception_success': perc_result.get('success', False),
            'error': perc_result.get('error', None)
        })
    
    return eval_results, case_info


def generate_failure_report(eval_results, case_info):
    """Generate detailed failure analysis report."""
    print("\n" + "=" * 80)
    print("FAILURE ANALYSIS REPORT")
    print("=" * 80)
    
    # Group by fault type
    fault_type_stats = {}
    for r in eval_results:
        ft = r['fault_type']
        if ft not in fault_type_stats:
            fault_type_stats[ft] = {'total': 0, 'correct': 0, 'failures': []}
        fault_type_stats[ft]['total'] += 1
        if r['is_correct']:
            fault_type_stats[ft]['correct'] += 1
        else:
            fault_type_stats[ft]['failures'].append(r)
    
    # Print summary by fault type
    print("\n" + "-" * 80)
    print("PASS RATE BY FAULT TYPE")
    print("-" * 80)
    
    perfect_types = []
    failing_types = []
    
    for ft, stats in sorted(fault_type_stats.items(), key=lambda x: -x[1]['correct']/max(x[1]['total'],1)):
        total = stats['total']
        correct = stats['correct']
        pass_rate = correct / total * 100 if total > 0 else 0
        print(f"  {ft}: {correct}/{total} ({pass_rate:.1f}% pass rate)")
        
        if pass_rate == 100.0:
            perfect_types.append(ft)
        else:
            failing_types.append((ft, stats))
    
    print(f"\n100% Pass Rate Types ({len(perfect_types)}):")
    for ft in perfect_types:
        print(f"  - {ft}")
    
    print(f"\nFailing Types ({len(failing_types)}):")
    for ft, stats in failing_types:
        total = stats['total']
        correct = stats['correct']
        pass_rate = correct / total * 100 if total > 0 else 0
        print(f"  - {ft}: {correct}/{total} ({pass_rate:.1f}% pass rate)")
    
    # Detailed failure analysis
    print("\n" + "-" * 80)
    print("DETAILED FAILURE ANALYSIS")
    print("-" * 80)
    
    all_failures = [r for r in eval_results if not r['is_correct']]
    
    # Group failures by fault type for root cause analysis
    failures_by_type = {}
    for r in all_failures:
        ft = r['fault_type']
        if ft not in failures_by_type:
            failures_by_type[ft] = []
        failures_by_type[ft].append(r)
    
    for ft, failures in sorted(failures_by_type.items(), key=lambda x: -len(x[1])):
        print(f"\n### {ft} ({len(failures)} failures) ###")
        
        # Analyze common patterns
        common_patterns = {
            'perception_failed': 0,
            'no_elements_predicted': 0,
            'type_mismatch': 0,
            'low_overlap': 0,
            'other': 0
        }
        
        for f in failures:
            if not f['perception_success']:
                common_patterns['perception_failed'] += 1
            elif len(f['pred_elements']) == 0 and len(f['pred_links']) == 0:
                common_patterns['no_elements_predicted'] += 1
            else:
                # Check for type mismatch or low overlap
                gt_has_elements = len(f['gt_elements']) > 0
                gt_has_links = len(f['gt_links']) > 0
                pred_has_elements = len(f['pred_elements']) > 0
                pred_has_links = len(f['pred_links']) > 0
                
                if (gt_has_elements and not pred_has_elements) or (gt_has_links and not pred_has_links):
                    common_patterns['type_mismatch'] += 1
                else:
                    common_patterns['low_overlap'] += 1
        
        print(f"  Patterns:")
        for pattern, count in common_patterns.items():
            if count > 0:
                print(f"    - {pattern}: {count}")
        
        # Print first 5 failure cases as examples
        print(f"  Example failures (first 5):")
        for f in failures[:5]:
            print(f"    Case {f['case_id']}:")
            print(f"      GT: elements={f['gt_elements']}, links={f['gt_links'][:3] if f['gt_links'] else []}...")
            print(f"      Pred: elements={f['pred_elements']}, links={f['pred_links'][:3] if f['pred_links'] else []}...")
            print(f"      Metrics: P={f['precision']:.2f}, R={f['recall']:.2f}, F1={f['f1_score']:.2f}")
            if f['error']:
                print(f"      Error: {f['error']}")
    
    # Overall stats
    total = len(eval_results)
    correct = sum(1 for r in eval_results if r['is_correct'])
    print("\n" + "-" * 80)
    print("OVERALL STATISTICS")
    print("-" * 80)
    print(f"Total cases: {total}")
    print(f"Correct: {correct}")
    print(f"Overall accuracy: {correct/total*100:.1f}%")
    
    # F1 score distribution
    f1_scores = [r['f1_score'] for r in eval_results]
    print(f"\nF1 Score Distribution:")
    print(f"  Mean: {sum(f1_scores)/len(f1_scores):.3f}")
    print(f"  Min: {min(f1_scores):.3f}")
    print(f"  Max: {max(f1_scores):.3f}")
    print(f"  F1=1.0: {sum(1 for s in f1_scores if s == 1.0)} cases")
    print(f"  F1=0.0: {sum(1 for s in f1_scores if s == 0.0)} cases")
    
    return eval_results


if __name__ == '__main__':
    eval_results, case_info = run_perception_and_evaluation()
    eval_results = generate_failure_report(eval_results, case_info)
    
    # Save results to file
    output_path = 'evaluation_results.json'
    with open(output_path, 'w') as f:
        json.dump(eval_results, f, indent=2)
    print(f"\nResults saved to: {output_path}")