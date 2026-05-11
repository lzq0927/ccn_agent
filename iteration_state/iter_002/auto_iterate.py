#!/usr/bin/env python3
"""
全自动迭代优化脚本 - 故障数据生成 → 故障感知 → 评估优化
"""

import sys
import os
import json
import time
from datetime import datetime

# Setup path
sys.path.insert(0, r'D:\code\project_ccn_agent_hermes\ccn_agent')

# Import iteration modules
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.accuracy import AccuracyEvaluator
from simulator.models import KPIRecord, FaultConfig

def run_full_iteration(iter_num):
    """运行完整迭代流程"""
    print(f"\n{'='*60}")
    print(f"# Iteration {iter_num:03d}: 故障数据生成 → 故障感知 → 评估优化")
    print(f"{'='*60}")
    
    start_time = time.time()
    
    # Import and reload modules
    import importlib
    import iteration_state.iter_001.run_iteration as ri_module
    importlib.reload(ri_module)
    
    from iteration_state.iter_001.run_iteration import main
    
    result = main()
    
    duration = time.time() - start_time
    
    # Load result
    summary_path = r'D:\code\project_ccn_agent_hermes\ccn_agent\iteration_state\iter_001\iteration_summary.json'
    with open(summary_path) as f:
        summary = json.load(f)
    
    eval_result = summary['phase3_evaluation']
    
    metrics = {
        'iteration': iter_num,
        'timestamp': datetime.now().isoformat(),
        'duration_seconds': duration,
        'precision': eval_result['overall_precision'],
        'recall': eval_result['overall_recall'],
        'f1': eval_result['overall_f1'],
        'correct': eval_result['correct_count'],
        'total': eval_result['evaluated_count'],
    }
    
    return metrics

def analyze_failures():
    """分析失败case的根本原因"""
    print("\n分析失败case...")
    
    import importlib
    import iteration_state.iter_001.run_iteration as ri_module
    importlib.reload(ri_module)
    
    from iteration_state.iter_001.run_iteration import load_case_data, build_perception_input
    from agents.fault_perception.agent import FaultPerceptionAgent
    from agents.evaluator.accuracy import AccuracyEvaluator
    
    agent = FaultPerceptionAgent(config={
        'confidence_threshold_high': 0.35,
        'confidence_threshold_medium': 0.20,
        'enable_self_optimization': False,
        'historical_cases': []
    })
    
    failed_analysis = []
    
    for case_num in range(11, 101):
        case_id = f"{case_num:03d}"
        case_data = load_case_data(case_id)
        gt = case_data.get('ground_truth', {})
        perception_input = build_perception_input(case_id, case_data)
        
        gt_elements = gt.get('fault_elements', [])
        gt_links = gt.get('fault_links', [])
        
        if not gt_elements and not gt_links:
            continue
        
        topo = perception_input['topology']
        
        agent_input = {
            'case_id': case_id,
            'kpi_records': [
                KPIRecord(
                    timestamp=rec['timestamp'],
                    level=rec['level'],
                    ue_id=rec['ue_id'],
                    src=rec['src'],
                    dst=rec['dst'],
                    success_rate=rec['success_rate']
                ) for rec in perception_input['kpi_records']
            ],
            'topology': topo,
            'business_flows': perception_input['business_flows']
        }
        
        result = agent.run(agent_input)
        output = result['output']
        pred_elements = output.get('perceived_fault_elements', [])
        
        evaluator = AccuracyEvaluator(topology=topo)
        gt_fault = FaultConfig(
            fault_point_type='SINGLE_NE', fault_mode='LINK',
            loss_rate=0.1, fault_start=20, fault_duration=10,
            affected_ne_ids=set(gt_elements),
            affected_links=gt_links
        )
        pred_fault = FaultConfig(
            fault_point_type='SINGLE_NE', fault_mode='LINK',
            loss_rate=0.1, fault_start=20, fault_duration=10,
            affected_ne_ids=set(pred_elements),
            affected_links=[]
        )
        
        match = evaluator._matches_ground_truth(pred_fault, gt_fault)
        
        if not match:
            # Categorize failure
            if gt_links:
                gt_type = f"LINK({len(gt_links)})"
            elif any(e.startswith('UE_') for e in gt_elements):
                gt_type = 'UE'
            elif any(e.startswith('gNB_') for e in gt_elements):
                gt_type = 'gNB'
            elif any(e.startswith('UPF_') for e in gt_elements):
                gt_type = 'UPF'
            elif any(e.startswith('SMF_') for e in gt_elements):
                gt_type = 'SMF'
            elif any(e.startswith('AMF_') for e in gt_elements):
                gt_type = 'AMF'
            else:
                gt_type = 'OTHER'
            
            failed_analysis.append({
                'case': case_id,
                'gt_type': gt_type,
                'gt_elements': gt_elements,
                'gt_links': gt_links[:3] if gt_links else [],
                'pred_elements': pred_elements,
            })
    
    # Group by type
    from collections import Counter
    type_counts = Counter(f['gt_type'] for f in failed_analysis)
    
    return {
        'total_failures': len(failed_analysis),
        'by_type': dict(type_counts),
        'cases': failed_analysis
    }

def suggest_fix(failure_analysis):
    """根据失败分析提出修复建议"""
    suggestions = []
    
    by_type = failure_analysis['by_type']
    total = failure_analysis['total_failures']
    
    # LINK故障检测问题
    link_failures = by_type.get('LINK(5)', 0) + by_type.get('LINK(1)', 0)
    if link_failures > 0:
        suggestions.append({
            'type': 'link_detection',
            'description': f'LINK故障检测不准确: {link_failures} cases',
            'action': 'skill_analyze_link_faults'
        })
    
    # UPF故障检测问题
    upf_failures = by_type.get('UPF', 0)
    if upf_failures > 0:
        suggestions.append({
            'type': 'upf_detection',
            'description': f'UPF故障检测不准确: {upf_failures} cases',
            'action': 'scenario_fix_upf_selection'
        })
    
    # gNB故障检测问题
    gnb_failures = by_type.get('gNB', 0)
    if gnb_failures > 0:
        suggestions.append({
            'type': 'gnb_detection',
            'description': f'gNB故障检测不准确: {gnb_failures} cases',
            'action': 'scenario_fix_gnb_selection'
        })
    
    return suggestions

def save_iteration_log(iter_num, metrics, failure_analysis, suggestions):
    """保存迭代日志"""
    log_path = r'D:\code\project_ccn_agent_hermes\ccn_agent\iteration_state\iter_002\iteration_log.md'
    
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f"\n## Iteration {iter_num:03d}\n")
        f.write(f"\n时间: {metrics['timestamp']}\n")
        f.write(f"耗时: {metrics['duration_seconds']:.1f}s\n")
        f.write(f"\n### 评估结果\n")
        f.write(f"- 精确率: {metrics['precision']:.3f}\n")
        f.write(f"- 召回率: {metrics['recall']:.3f}\n")
        f.write(f"- F1分数: {metrics['f1']:.3f}\n")
        f.write(f"- 正确数: {metrics['correct']}/{metrics['total']}\n")
        f.write(f"\n### 失败分析\n")
        f.write(f"总计: {failure_analysis['total_failures']} cases\n")
        for t, c in failure_analysis['by_type'].items():
            f.write(f"- {t}: {c}\n")
        f.write(f"\n### 修复建议\n")
        for s in suggestions:
            f.write(f"- [{s['type']}] {s['description']}\n")

def main():
    """主入口"""
    print("=" * 60)
    print("故障感知系统 - 全自动迭代优化")
    print("=" * 60)
    
    os.makedirs(r'D:\code\project_ccn_agent_hermes\ccn_agent\iteration_state\iter_002', exist_ok=True)
    
    # Clear previous log
    log_path = r'D:\code\project_ccn_agent_hermes\ccn_agent\iteration_state\iter_002\iteration_log.md'
    with open(log_path, 'w', encoding='utf-8') as f:
        f.write("# 迭代优化日志\n\n")
    
    # Run iterations
    best_f1 = 0.0
    best_iter = 0
    metrics_history = []
    
    for i in range(1, 6):  # 最多5次迭代
        # Run full iteration
        metrics = run_full_iteration(i)
        metrics_history.append(metrics)
        
        # Analyze failures
        failure_analysis = analyze_failures()
        
        # Generate suggestions
        suggestions = suggest_fix(failure_analysis)
        
        # Save log
        save_iteration_log(i, metrics, failure_analysis, suggestions)
        
        print(f"\n结果: P={metrics['precision']:.3f}, R={metrics['recall']:.3f}, F1={metrics['f1']:.3f}")
        print(f"失败: {failure_analysis['total_failures']} cases")
        
        if metrics['f1'] > best_f1:
            best_f1 = metrics['f1']
            best_iter = i
        
        # Check if good enough
        if metrics['f1'] >= 0.90:
            print(f"\n达到目标F1>=0.90，停止迭代")
            break
        
        # Small delay between iterations
        time.sleep(1)
    
    print(f"\n{'='*60}")
    print(f"迭代完成! 最佳: Iteration {best_iter}, F1={best_f1:.3f}")
    print(f"{'='*60}")
    
    # Save summary
    summary = {
        'best_iteration': best_iter,
        'best_f1': best_f1,
        'metrics_history': metrics_history,
        'timestamp': datetime.now().isoformat()
    }
    
    with open(r'D:\code\project_ccn_agent_hermes\ccn_agent\iteration_state\iter_002\iteration_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    return best_f1, best_iter

if __name__ == '__main__':
    main()
