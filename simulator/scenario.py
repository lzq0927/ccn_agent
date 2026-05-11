import random
from .models import (
    FaultConfig, FaultMode, FaultPointType,
    NEType, Scenario, MASTER_STANDBY_TYPES
)
from .topology import TopologyGenerator
from .process import PROCESS_DEFINITIONS


# Distribution of fault point types across 90 fault cases (10 normal)
FAULT_DISTRIBUTION = [
    (FaultPointType.SINGLE_NE, 15),
    (FaultPointType.MULTI_NE, 8),
    (FaultPointType.ALL_TYPE_NE, 8),
    (FaultPointType.MULTI_TYPE_NE, 5),
    (FaultPointType.RESOURCE_POOL, 10),
    (FaultPointType.DC, 8),
    (FaultPointType.PATH_LINK, 10),
    (FaultPointType.PATH_TRACE, 8),
    (FaultPointType.PATH_SESSION, 6),
    (FaultPointType.SWITCH, 12),
]

PROCESS_NAMES = [
    "PDU_Session_Establishment", "Registration", "Handover",
    "PDU_Session_Release", "Service_Request",
]


class ScenarioGenerator:
    def __init__(self, topologies):
        self.topologies = topologies  # {index: Topology}
        self.topo_indices = list(topologies.keys())

    def generate(self, num_cases=100, seed=42):
        random.seed(seed)

        # Build ordered fault type list
        fault_types = []
        for ftype, count in FAULT_DISTRIBUTION:
            fault_types.extend([ftype] * count)
        random.shuffle(fault_types)

        # 10 normal cases + 90 fault cases
        normal_count = num_cases - len(fault_types)
        assert normal_count == 10

        # Assign train/test split (4:6): deterministic, first 40 are train
        # Shuffle to mix normal and fault cases, but first 40 shuffled indices = train set
        case_indices = list(range(num_cases))
        random.shuffle(case_indices)
        train_indices = set(case_indices[:40])  # first 40 after shuffle = train

        scenarios = []
        fault_idx = 0

        for ci in case_indices:
            is_normal = ci < normal_count
            is_train = ci in train_indices

            # Round-robin topology and process
            topo_idx = self.topo_indices[ci % len(self.topo_indices)]
            process_name = PROCESS_NAMES[ci % len(PROCESS_NAMES)]
            topology = self.topologies[topo_idx]

            ue_count = random.randint(50, 100)

            if is_normal:
                fault_config = None
            else:
                fault_type = fault_types[fault_idx]
                fault_mode = random.choice([FaultMode.LINK, FaultMode.BUSINESS])
                fault_config = self._build_fault_config(
                    fault_type, fault_mode, topology, process_name
                )
                fault_idx += 1

            scenarios.append(Scenario(
                case_id=ci + 1,
                topology=topology,
                process_name=process_name,
                ue_count=ue_count,
                fault_config=fault_config,
                is_normal=is_normal,
                is_train=is_train,
            ))

        # Sort by case_id
        scenarios.sort(key=lambda s: s.case_id)
        return scenarios

    def _build_fault_config(self, fault_type, fault_mode, topology, process_name):
        # Increased loss_rate for better detection: 0.10-0.25 (was 0.03-0.08)
        # This ensures deviation >= 0.05 even after dilution
        loss_rate = round(random.uniform(0.10, 0.25), 4)
        fault_start = random.randint(15, 25)  # Earlier start for more fault period
        fault_duration = random.randint(25, 35)  # Longer duration to reduce dilution

        fc = FaultConfig(
            fault_point_type=fault_type,
            fault_mode=fault_mode,
            loss_rate=loss_rate,
            fault_start=fault_start,
            fault_duration=fault_duration,
        )

        # Get NE types that participate in this process
        process_def = PROCESS_DEFINITIONS.get(process_name, {})
        required_types = process_def.get('required_types', [])
        
        # Filter to only NE types (not UE, not gNB_src/gNB_tgt)
        valid_ne_types = [t for t in required_types if t not in ['UE', 'gNB_src', 'gNB_tgt']]
        
        # For PATH_LINK/PATH_TRACE/PATH_SESSION, use all available NEs
        if fault_type in [FaultPointType.PATH_LINK, FaultPointType.PATH_TRACE, FaultPointType.PATH_SESSION]:
            pass  # These will resolve links from actual flows
        elif fault_type in [FaultPointType.ALL_TYPE_NE, FaultPointType.MULTI_TYPE_NE]:
            # Only use types that participate in the process
            if fault_type == FaultPointType.ALL_TYPE_NE:
                ne_type = random.choice(valid_ne_types) if valid_ne_types else random.choice(list(NEType))
                fc.affected_ne_ids = {ne.id for ne in topology.get_elements_by_type(ne_type)}
                return fc
            elif fault_type == FaultPointType.MULTI_TYPE_NE:
                types = random.sample(valid_ne_types, min(random.randint(2, 3), len(valid_ne_types)))
                for t in types:
                    fc.affected_ne_ids.update(ne.id for ne in topology.get_elements_by_type(t))
                return fc

        if fault_type == FaultPointType.SINGLE_NE:
            self._fault_single_ne(fc, topology, valid_ne_types)
        elif fault_type == FaultPointType.MULTI_NE:
            self._fault_multi_ne(fc, topology, valid_ne_types)
        elif fault_type == FaultPointType.ALL_TYPE_NE:
            self._fault_all_type_ne(fc, topology, valid_ne_types)
        elif fault_type == FaultPointType.MULTI_TYPE_NE:
            self._fault_multi_type_ne(fc, topology, valid_ne_types)
        elif fault_type == FaultPointType.RESOURCE_POOL:
            self._fault_resource_pool(fc, topology)
        elif fault_type == FaultPointType.DC:
            self._fault_dc(fc, topology)
        elif fault_type == FaultPointType.PATH_LINK:
            self._fault_path_link(fc, topology)
        elif fault_type == FaultPointType.PATH_TRACE:
            self._fault_path_trace(fc, topology)
        elif fault_type == FaultPointType.PATH_SESSION:
            self._fault_path_session(fc, topology)
        elif fault_type == FaultPointType.SWITCH:
            self._fault_switch(fc, topology)

        return fc

    def _fault_single_ne(self, fc, topo, valid_ne_types):
        all_ne = list(topo.elements.keys())
        # Only select NEs that participate in the process
        participating_ne = [ne for ne in all_ne if any(ne.startswith(t + '_') for t in valid_ne_types)]
        if participating_ne:
            ne_id = random.choice(participating_ne)
        else:
            ne_id = random.choice(all_ne)
        fc.affected_ne_ids = {ne_id}

    def _fault_multi_ne(self, fc, topo, valid_ne_types):
        all_ne = list(topo.elements.keys())
        # Only select NEs that participate in the process
        participating_ne = [ne for ne in all_ne if any(ne.startswith(t + '_') for t in valid_ne_types)]
        if not participating_ne:
            participating_ne = all_ne
        count = random.randint(2, min(5, len(participating_ne)))
        fc.affected_ne_ids = set(random.sample(participating_ne, count))

    def _fault_all_type_ne(self, fc, topo, valid_ne_types):
        if valid_ne_types:
            ne_type = random.choice(valid_ne_types)
        else:
            ne_type = random.choice(list(NEType))
        fc.affected_ne_ids = {ne.id for ne in topo.get_elements_by_type(ne_type)}

    def _fault_multi_type_ne(self, fc, topo, valid_ne_types):
        if valid_ne_types:
            types = random.sample(valid_ne_types, min(random.randint(2, 3), len(valid_ne_types)))
        else:
            types = random.sample(list(NEType), random.randint(2, 3))
        for t in types:
            fc.affected_ne_ids.update(ne.id for ne in topo.get_elements_by_type(t))

    def _fault_resource_pool(self, fc, topo):
        pool_ids = topo.get_pool_ids()
        pool_id = random.choice(pool_ids)
        fc.affected_ne_ids = {ne.id for ne in topo.get_elements_by_pool(pool_id)}

    def _fault_dc(self, fc, topo):
        dc_ids = topo.get_dc_ids()
        dc_id = random.choice(dc_ids)
        fc.affected_ne_ids = {ne.id for ne in topo.get_elements_by_dc(dc_id)}

    def _fault_path_link(self, fc, topo):
        fc.num_affected_paths = random.randint(1, 3)
        # Links will be resolved during simulation based on actual flows
        fc.fault_mode = FaultMode.LINK

    def _fault_path_trace(self, fc, topo):
        fc.num_affected_paths = random.randint(1, 3)
        fc.fault_mode = FaultMode.BUSINESS

    def _fault_path_session(self, fc, topo):
        fc.num_affected_paths = random.randint(1, 3)
        fc.fault_mode = FaultMode.BUSINESS

    def _fault_switch(self, fc, topo):
        sw_ids = list(topo.switches.keys())
        sw_id = random.choice(sw_ids)
        fc.affected_switch = sw_id
        # Get all NEs in the affected pool
        ne_ids_in_pool = topology_get_pool_ne_ids(topo, sw_id)
        # Generate affected links: all intra-pool links
        ne_list = list(ne_ids_in_pool)
        links = []
        for i in range(len(ne_list)):
            for j in range(i + 1, len(ne_list)):
                links.append((ne_list[i], ne_list[j]))
        fc.affected_links = links
        fc.fault_mode = FaultMode.LINK


def topology_get_pool_ne_ids(topo, switch_id):
    """Get NE IDs in the pool associated with a switch."""
    return set(topo.switches.get(switch_id, []))
