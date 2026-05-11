import json, sys, os
sys.path.insert(0, os.path.dirname(__file__))

from simulator.topology import TopologyGenerator
from simulator.models import FaultConfig, FaultPointType, FaultMode, KPIRecord, BusinessFlow
from agents.evaluator.accuracy import AccuracyEvaluator

def load_case_data(case_id):
    case_dir = f"data/case_{case_id}"
    if not os.path.exists(case_dir):
        return None
    result = {}
    kpi_records = []
    data_csv_path = os.path.join(case_dir, "data.csv")
    if os.path.exists(data_csv_path):
        with open(data_csv_path) as f:
            f.readline()
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
    result_txt_path = os.path.join(case_dir, "result.txt")
    if os.path.exists(result_txt_path):
        with open(result_txt_path) as f:
            result['ground_truth'] = json.load(f)
    else:
        result['ground_truth'] = {'fault_elements': [], 'fault_links': []}
    process_path = os.path.join(case_dir, "process.txt")
    if os.path.exists(process_path):
        with open(process_path) as f:
            result['process_content'] = f.read()
    return result

def parse_fault_config_from_result(result, topology):
    fault_elements = result.get('fault_elements', [])
    fault_links = result.get('fault_links', [])
    if not fault_elements and not fault_links:
        return None
    affected_ne_ids = set()
    affected_links = []
    for elem in fault_elements:
        if '_' in elem:
            affected_ne_ids.add(elem)
    for link in fault_links:
        if '-' in link:
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

topo_gen = TopologyGenerator()
topology = topo_gen.generate(0, seed=42)
accuracy_evaluator = AccuracyEvaluator(topology)

# Test case 011
case_id = '011'
case_data = load_case_data(case_id)
print(f"=== Case {case_id} ===")
print(f"GT: {case_data['ground_truth']}")

ground_truth = parse_fault_config_from_result(case_data.get('ground_truth', {}), topology)
print(f"Parsed GT: fpt={ground_truth.fault_point_type}, ne_ids={ground_truth.affected_ne_ids}")

# Simulate perception output (what the agent actually returned)
perception_output = {
    'perceived_fault_elements': ['', 'AMF_1', 'gNB_2', 'SMF_2', 'gNB_1'],
    'perceived_fault_links': []
}

# Build predicted faults like the iteration code does
perceived_elements = [e for e in perception_output.get('perceived_fault_elements', []) if e]
perceived_links = perception_output.get('perceived_fault_links', [])
print(f"After filtering empty: perceived_elements={perceived_elements}")

predicted_faults = []
if perceived_elements or perceived_links:
    if perceived_elements and not perceived_links:
        if len(perceived_elements) == 1:
            fpt = FaultPointType.SINGLE_NE
        else:
            fpt = FaultPointType.MULTI_NE
    elif perceived_links and not perceived_elements:
        fpt = FaultPointType.PATH_LINK
    else:
        fpt = FaultPointType.MULTI_NE
    
    predicted_faults.append(FaultConfig(
        fault_point_type=fpt,
        fault_mode=FaultMode.LINK,
        loss_rate=0.0,
        fault_start=0,
        fault_duration=0,
        affected_ne_ids=set(perceived_elements),
        affected_links=[]
    ))

print(f"Predicted faults: fpt={predicted_faults[0].fault_point_type}, ne_ids={predicted_faults[0].affected_ne_ids}")
print(f"Match check: GT.fpt={ground_truth.fault_point_type}, Pred.fpt={predicted_faults[0].fault_point_type}")

# Test the matching
match = accuracy_evaluator._matches_ground_truth(predicted_faults[0], ground_truth)
print(f"_matches_ground_truth: {match}")

# Run evaluation
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

metrics = accuracy_evaluator.evaluate(
    predicted_faults=predicted_faults,
    ground_truth=ground_truth,
    kpi_records=kpi_records,
    flows=flows
)

print(f"Metrics: P={metrics.precision:.3f} R={metrics.recall:.3f} F1={metrics.f1_score:.3f}")
print(f"TP={metrics.true_positives} FP={metrics.false_positives} FN={metrics.false_negatives}")
print(f"Is correct (F1>=0.9): {metrics.f1_score >= 0.9}")
