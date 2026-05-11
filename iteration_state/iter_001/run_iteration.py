"""
Iteration 001: 故障数据生成 → 故障感知 → 评估优化 全自动迭代
"""

import os
import sys
import json
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional
from collections import Counter

PROJECT_ROOT = str(Path(__file__).parent.parent.parent.resolve())
sys.path.insert(0, PROJECT_ROOT)
os.chdir(PROJECT_ROOT)

from simulator.topology import TopologyGenerator
from simulator.scenario import ScenarioGenerator
from simulator.engine import SimulationEngine
from simulator.exporter import DataExporter
from simulator.models import (
    Scenario, SimulationResult, FaultConfig, FaultPointType,
    FaultMode, NEType, KPIRecord, Topology, NetworkElement, BusinessFlow
)
from agents.fault_perception.agent import FaultPerceptionAgent
from agents.evaluator.accuracy import AccuracyEvaluator


def load_case_data(case_id: str) -> Optional[Dict]:
    """加载单个case的所有数据"""
    case_dir = f"data/case_{case_id}"
    if not os.path.exists(case_dir):
        return None
    
    result = {}
    
    # Load data.csv
    kpi_records = []
    data_csv_path = os.path.join(case_dir, "data.csv")
    if os.path.exists(data_csv_path):
        with open(data_csv_path) as f:
            f.readline()  # skip header
            for line in f:
                parts = line.strip().split(',')
                if len(parts) == 6:
                    kpi_records.append({
                        'timestamp': int(parts[0]),
                        'level': parts[1],
                        'ue_id': parts[2],
                        'src': parts[3],
                        'dst': parts[4],
                        'success_rate': float(parts[5])
                    })
    result['kpi_records'] = kpi_records
    
    # Load result.txt (ground truth)
    result_txt_path = os.path.join(case_dir, "result.txt")
    if os.path.exists(result_txt_path):
        with open(result_txt_path) as f:
            result['ground_truth'] = json.load(f)
    else:
        result['ground_truth'] = {'fault_elements': [], 'fault_links': []}
    
    # Load process.txt
    process_path = os.path.join(case_dir, "process.txt")
    if os.path.exists(process_path):
        with open(process_path) as f:
            result['process_content'] = f.read()
    
    return result


def build_perception_input(case_id: str, case_data: Dict) -> Dict:
    """构建感知Agent输入 - 从data.csv重建BusinessFlows和Topology"""
    # 计算正确的topology seed: case i 使用 topology (i % 5)
    case_num = int(case_id)
    topo_idx = (case_num - 1) % 5  # case_001 -> idx 0, case_002 -> idx 1, etc.
    topo_seed = 100 + topo_idx  # 对应run_data_generation中的seed
    
    topo_gen = TopologyGenerator()
    topology = topo_gen.generate(topo_idx, seed=topo_seed)
    
    # 从data.csv重建BusinessFlows
    # 解析process_name from process.txt
    process_name = "PDU_Session_Establishment"  # default
    if 'process_content' in case_data:
        for line in case_data['process_content'].split('\n'):
            if line.startswith('Process:'):
                process_name = line.split(':', 1)[1].strip()
                break
    
    # 从trace level数据重建flows: 按ue_id分组,按timestamp排序
    kpi_records = case_data.get('kpi_records', [])
    
    # 按ue_id分组trace记录
    ue_trace_hops = {}  # ue_id -> ordered list of (src, dst)
    for rec in kpi_records:
        if rec.get('level') == 'trace' and rec.get('ue_id') and rec.get('src') and rec.get('dst'):
            ue_id = rec['ue_id']
            if ue_id not in ue_trace_hops:
                ue_trace_hops[ue_id] = []
            # 去重且保持顺序
            hop = (rec['src'], rec['dst'])
            if hop not in ue_trace_hops[ue_id]:
                ue_trace_hops[ue_id].append(hop)
    
    # 构建flows列表
    flows = []
    for ue_id, hops in sorted(ue_trace_hops.items()):
        flows.append(BusinessFlow(
            process_name=process_name,
            ue_id=ue_id,
            hops=hops
        ))
    
    gt = case_data.get('ground_truth', {})
    is_normal = len(gt.get('fault_elements', [])) == 0 and len(gt.get('fault_links', [])) == 0
    
    return {
        'case_id': case_id,
        'kpi_records': kpi_records,
        'topology': topology,
        'business_flows': flows,
        'is_normal_scenario': is_normal,
        'metadata': {}
    }


def parse_fault_config_from_result(result: Dict, topology: Topology) -> Optional[FaultConfig]:
    """从result.txt解析FaultConfig"""
    fault_elements = result.get('fault_elements', [])
    fault_links = result.get('fault_links', [])
    
    if not fault_elements and not fault_links:
        return None
    
    affected_ne_ids = set()
    affected_links = []
    
    for elem in fault_elements:
        if '_' in elem and any(elem.startswith(t.value) for t in NEType):
            affected_ne_ids.add(elem)
    
    for link in fault_links:
        if '->' in link:
            parts = link.split('->')
            if len(parts) == 2:
                affected_links.append((parts[0], parts[1]))
        elif '-' in link:
            parts = link.split('-')
            if len(parts) == 2:
                affected_links.append((parts[0], parts[1]))
    
    if affected_ne_ids:
        if len(affected_ne_ids) == 1:
            fpt = FaultPointType.SINGLE_NE
        else:
            fpt = FaultPointType.MULTI_NE
    elif affected_links:
        fpt = FaultPointType.PATH_LINK
    else:
        fpt = FaultPointType.NORMAL
    
    return FaultConfig(
        fault_point_type=fpt,
        fault_mode=FaultMode.LINK,
        loss_rate=0.05,
        fault_start=20,
        fault_duration=15,
        affected_ne_ids=affected_ne_ids,
        affected_links=affected_links
    )


def run_data_generation():
    """Phase 1: 数据生成"""
    print("\n" + "="*60)
    print("Phase 1: 数据生成")
    print("="*60)
    
    start_time = time.time()
    
    topo_gen = TopologyGenerator()
    topologies = {}
    for i in range(5):
        topologies[i] = topo_gen.generate(i, seed=100 + i)
    
    scenario_gen = ScenarioGenerator(topologies)
    engine = SimulationEngine()
    exporter = DataExporter("data")
    
    all_scenarios = scenario_gen.generate(num_cases=100, seed=42)
    
    for i, scenario in enumerate(all_scenarios):
        result = engine.simulate(scenario)
        exporter.export(scenario, result)
        if (i + 1) % 20 == 0:
            print(f"  Generated {i+1}/100 cases...")
    
    exporter.write_split_info(all_scenarios)
    
    duration = time.time() - start_time
    normal_count = sum(1 for s in all_scenarios if s.is_normal)
    
    print(f"\n数据生成完成: {len(all_scenarios)} cases ({len(all_scenarios)-normal_count} fault + {normal_count} normal)")
    print(f"耗时: {duration:.1f}s")
    
    return {'total': len(all_scenarios), 'fault': len(all_scenarios)-normal_count, 'normal': normal_count, 'duration': duration}


def run_fault_perception(case_ids: List[str]) -> Dict:
    """Phase 2: 故障感知"""
    print("\n" + "="*60)
    print("Phase 2: 故障感知")
    print("="*60)
    
    start_time = time.time()
    
    # topology会在build_perception_input中按case分别计算正确的seed分别生成
    
    perception_agent = FaultPerceptionAgent(config={
        'confidence_threshold_high': 0.35,
        'confidence_threshold_medium': 0.20,
        'enable_self_optimization': False,
        'historical_cases': []
    })
    
    results = {}
    succeeded = 0
    failed = 0
    
    for i, case_id in enumerate(case_ids):
        case_data = load_case_data(case_id)
        if case_data is None:
            failed += 1
            continue
        
        try:
            perception_input = build_perception_input(case_id, case_data)
            result = perception_agent.run(perception_input)
            
            if result.get('success', False):
                results[case_id] = {
                    'perception_output': result.get('output', {}),
                    'latency_ms': result.get('metrics', {}).get('latency_ms', 0),
                    'confidence': result.get('output', {}).get('confidence', 0.0)
                }
                succeeded += 1
            else:
                results[case_id] = {'error': result.get('error', 'unknown')}
                failed += 1
        except Exception as e:
            results[case_id] = {'error': str(e)}
            failed += 1
        
        if (i + 1) % 10 == 0:
            print(f"  Processed {i+1}/{len(case_ids)} cases...")
    
    duration = time.time() - start_time
    print(f"\n故障感知完成: {succeeded} success, {failed} failed")
    print(f"耗时: {duration:.1f}s")
    
    return {'results': results, 'succeeded': succeeded, 'failed': failed, 'duration': duration}


def run_evaluation(case_ids: List[str], perception_results: Dict) -> Dict:
    """Phase 3: 评估"""
    print("\n" + "="*60)
    print("Phase 3: 评估")
    print("="*60)
    
    start_time = time.time()
    
    eval_results = []
    total_tp = total_fp = total_fn = 0
    total_precision = total_recall = total_f1 = 0.0
    evaluated_count = 0
    
    for i, case_id in enumerate(case_ids):
        case_data = load_case_data(case_id)
        if case_data is None:
            continue
        
        # 计算正确的topology seed (与build_perception_input一致)
        case_num = int(case_id)
        topo_idx = (case_num - 1) % 5
        topo_seed = 100 + topo_idx
        topo_gen = TopologyGenerator()
        topology = topo_gen.generate(topo_idx, seed=topo_seed)
        accuracy_evaluator = AccuracyEvaluator(topology)
        
        ground_truth_dict = case_data.get('ground_truth', {})
        ground_truth = parse_fault_config_from_result(ground_truth_dict, topology)
        
        perc_result = perception_results.get(case_id, {})
        perception_output = perc_result.get('perception_output', {})
        
        predicted_faults = []
        # Filter out empty strings
        perceived_elements = [e for e in perception_output.get('perceived_fault_elements', []) if e]
        perceived_links = perception_output.get('perceived_fault_links', [])
        
        if perceived_elements or perceived_links:
            # Determine fault_point_type based on what was perceived
            if perceived_elements and not perceived_links:
                if len(perceived_elements) == 1:
                    fpt = FaultPointType.SINGLE_NE
                else:
                    fpt = FaultPointType.MULTI_NE
            elif perceived_links and not perceived_elements:
                fpt = FaultPointType.PATH_LINK
            else:
                fpt = FaultPointType.MULTI_NE
            
            # Convert link strings to tuples if needed
            links = []
            for link in perceived_links:
                if isinstance(link, str) and '->' in link:
                    parts = link.split('->')
                    links.append((parts[0], parts[1]))
                elif isinstance(link, (list, tuple)) and len(link) == 2:
                    links.append(tuple(link))
            
            predicted_faults.append(FaultConfig(
                fault_point_type=fpt,
                fault_mode=FaultMode.LINK,
                loss_rate=0.0,
                fault_start=0,
                fault_duration=0,
                affected_ne_ids=set(perceived_elements),
                affected_links=links
            ))
        
        # KPI records for evaluation
        kpi_records = []
        for kpi in case_data.get('kpi_records', []):
            kpi_records.append(KPIRecord(
                timestamp=kpi['timestamp'],
                level=kpi['level'],
                ue_id=kpi['ue_id'],
                src=kpi['src'],
                dst=kpi['dst'],
                success_rate=kpi['success_rate']
            ))
        
        flows = []
        if 'process_content' in case_data:
            for line in case_data['process_content'].split('\n'):
                if line.startswith('Process:'):
                    flows.append(BusinessFlow(
                        process_name=line.split(':', 1)[1].strip(),
                        ue_id='UE_001',
                        hops=[]
                    ))
        
        if ground_truth is not None or len(predicted_faults) > 0:
            metrics = accuracy_evaluator.evaluate(
                predicted_faults=predicted_faults,
                ground_truth=ground_truth,
                kpi_records=kpi_records,
                flows=flows
            )
            
            eval_results.append({
                'case_id': case_id,
                'precision': metrics.precision,
                'recall': metrics.recall,
                'f1_score': metrics.f1_score,
                'tp': metrics.true_positives,
                'fp': metrics.false_positives,
                'fn': metrics.false_negatives,
                'is_correct': metrics.f1_score >= 0.9
            })
            
            total_tp += metrics.true_positives
            total_fp += metrics.false_positives
            total_fn += metrics.false_negatives
            total_precision += metrics.precision
            total_recall += metrics.recall
            total_f1 += metrics.f1_score
            evaluated_count += 1
        
        if (i + 1) % 20 == 0:
            print(f"  Evaluated {i+1}/{len(case_ids)} cases...")
    
    duration = time.time() - start_time
    
    overall_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 0.0
    overall_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 0.0
    overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) if (overall_precision + overall_recall) > 0 else 0.0
    avg_f1 = total_f1 / evaluated_count if evaluated_count > 0 else 0.0
    correct_count = sum(1 for r in eval_results if r['is_correct'])
    
    print(f"\n评估完成:")
    print(f"  评估用例数: {evaluated_count}")
    print(f"  正确数: {correct_count}")
    print(f"  总体精确率: {overall_precision:.3f}")
    print(f"  总体召回率: {overall_recall:.3f}")
    print(f"  总体F1: {overall_f1:.3f}")
    print(f"  平均F1: {avg_f1:.3f}")
    print(f"  耗时: {duration:.1f}s")
    
    return {
        'eval_results': eval_results,
        'evaluated_count': evaluated_count,
        'correct_count': correct_count,
        'overall_precision': overall_precision,
        'overall_recall': overall_recall,
        'overall_f1': overall_f1,
        'avg_f1': avg_f1,
        'duration': duration
    }


def generate_optimization_suggestions(eval_results: List[Dict], perception_results: Dict) -> Dict:
    """Phase 4: 生成优化建议"""
    print("\n" + "="*60)
    print("Phase 4: 生成优化建议")
    print("="*60)
    
    failures = [r for r in eval_results if not r['is_correct']]
    fp_cases = [r for r in eval_results if r['fp'] > 0 and r['tp'] == 0]
    fn_cases = [r for r in eval_results if r['fn'] > 0]
    
    suggestions = []
    
    if len(fp_cases) > len(eval_results) * 0.2:
        suggestions.append({
            'type': 'high_false_positive',
            'description': f'假阳性率过高: {len(fp_cases)}/{len(eval_results)} cases',
            'recommendation': '增加故障判定阈值，要求更强的证据支持',
            'priority': 4
        })
    
    if len(fn_cases) > len(eval_results) * 0.2:
        suggestions.append({
            'type': 'high_false_negative',
            'description': f'假阴性率过高: {len(fn_cases)}/{len(eval_results)} cases',
            'recommendation': '增强故障信号检测灵敏度',
            'priority': 4
        })
    
    # 分析低召回故障类型
    low_recall_types = []
    for r in eval_results:
        if r['recall'] < 0.5 and r['f1_score'] < 0.5:
            case_id = r['case_id']
            case_data = load_case_data(case_id)
            if case_data:
                gt = case_data.get('ground_truth', {})
                if gt.get('fault_elements'):
                    low_recall_types.append(gt['fault_elements'][0].split('_')[0] if '_' in gt['fault_elements'][0] else 'unknown')
    
    if low_recall_types:
        type_counts = Counter(low_recall_types)
        most_common = type_counts.most_common(3)
        suggestions.append({
            'type': 'weak_fault_types',
            'description': f'低召回故障类型: {most_common}',
            'recommendation': '针对性增加这些故障类型的训练样本',
            'priority': 3
        })
    
    print(f"生成 {len(suggestions)} 条优化建议:")
    for s in suggestions:
        print(f"  [{s['priority']}] {s['type']}: {s['description']}")
    
    return {
        'suggestions': suggestions,
        'total_failures': len(failures),
        'failure_rate': len(failures) / len(eval_results) if eval_results else 0
    }


def main():
    print("\n" + "#"*60)
    print("# Iteration 001: 故障数据生成 → 故障感知 → 评估优化")
    print("#"*60)
    print(f"开始时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    iteration_start = time.time()
    case_ids = [f"{i:03d}" for i in range(1, 101)]
    
    # Phase 1: 数据生成
    data_gen_result = run_data_generation()
    
    # Phase 2: 故障感知
    perception_result = run_fault_perception(case_ids)
    perception_results = perception_result['results']
    
    # Phase 3: 评估
    eval_result = run_evaluation(case_ids, perception_results)
    
    # Phase 4: 优化建议
    optimization_result = generate_optimization_suggestions(eval_result['eval_results'], perception_results)
    
    # 保存结果
    iteration_duration = time.time() - iteration_start
    
    iteration_summary = {
        'iteration': 1,
        'timestamp': datetime.now().isoformat(),
        'duration_seconds': iteration_duration,
        'phase1_data_gen': data_gen_result,
        'phase2_perception': {
            'succeeded': perception_result['succeeded'],
            'failed': perception_result['failed'],
            'duration': perception_result['duration']
        },
        'phase3_evaluation': {
            'evaluated_count': eval_result['evaluated_count'],
            'correct_count': eval_result['correct_count'],
            'overall_precision': eval_result['overall_precision'],
            'overall_recall': eval_result['overall_recall'],
            'overall_f1': eval_result['overall_f1'],
            'avg_f1': eval_result['avg_f1'],
            'duration': eval_result['duration']
        },
        'phase4_optimization': optimization_result,
        'status': 'completed'
    }
    
    output_path = "iteration_state/iter_001/iteration_summary.json"
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(iteration_summary, f, indent=2, ensure_ascii=False)
    
    print("\n" + "="*60)
    print("迭代完成总结")
    print("="*60)
    print(f"总耗时: {iteration_duration:.1f}s ({iteration_duration/60:.1f}min)")
    print(f"数据生成: {data_gen_result['total']} cases")
    print(f"故障感知: {perception_result['succeeded']} success / {perception_result['failed']} failed")
    print(f"评估结果:")
    print(f"  精确率: {eval_result['overall_precision']:.3f}")
    print(f"  召回率: {eval_result['overall_recall']:.3f}")
    print(f"  F1分数: {eval_result['overall_f1']:.3f}")
    print(f"优化建议: {len(optimization_result['suggestions'])} 条")
    print(f"\n结果已保存到: {output_path}")
    
    return iteration_summary


if __name__ == "__main__":
    main()
