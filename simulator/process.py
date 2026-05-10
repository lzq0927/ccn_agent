import random
from .models import NEType, BusinessFlow

# 5 business process definitions
# Each hop is (src_type, dst_type); "UE" is the user equipment endpoint
PROCESS_DEFINITIONS = {
    "PDU_Session_Establishment": {
        "description": "PDU会话建立",
        "hops": [
            ("UE", "gNB"), ("gNB", "AMF"), ("AMF", "SMF"), ("SMF", "UDM"),
            ("UDM", "SMF"), ("SMF", "PCF"), ("PCF", "SMF"), ("SMF", "UPF"),
            ("UPF", "SMF"), ("SMF", "AMF"), ("AMF", "gNB"), ("gNB", "UE"),
        ],
        "required_types": ["gNB", "AMF", "SMF", "UDM", "PCF", "UPF"],
    },
    "Registration": {
        "description": "注册",
        "hops": [
            ("UE", "gNB"), ("gNB", "AMF"), ("AMF", "AUSF"), ("AUSF", "UDM"),
            ("UDM", "AUSF"), ("AUSF", "AMF"), ("AMF", "UDM"), ("UDM", "AMF"),
            ("AMF", "gNB"), ("gNB", "UE"),
        ],
        "required_types": ["gNB", "AMF", "AUSF", "UDM"],
    },
    "Handover": {
        "description": "切换",
        "hops": [
            ("UE", "gNB_src"), ("gNB_src", "AMF"), ("AMF", "SMF"), ("SMF", "UPF"),
            ("UPF", "SMF"), ("SMF", "AMF"), ("AMF", "gNB_tgt"),
            ("gNB_tgt", "AMF"), ("AMF", "gNB_src"), ("gNB_src", "UE"),
            ("UE", "gNB_tgt"),
        ],
        "required_types": ["gNB_src", "gNB_tgt", "AMF", "SMF", "UPF"],
    },
    "PDU_Session_Release": {
        "description": "PDU会话释放",
        "hops": [
            ("UE", "gNB"), ("gNB", "AMF"), ("AMF", "SMF"), ("SMF", "UPF"),
            ("UPF", "SMF"), ("SMF", "PCF"), ("PCF", "SMF"), ("SMF", "AMF"),
            ("AMF", "gNB"), ("gNB", "UE"),
        ],
        "required_types": ["gNB", "AMF", "SMF", "UPF", "PCF"],
    },
    "Service_Request": {
        "description": "服务请求",
        "hops": [
            ("UE", "gNB"), ("gNB", "AMF"), ("AMF", "SMF"), ("SMF", "UPF"),
            ("UPF", "SMF"), ("SMF", "AMF"), ("AMF", "gNB"), ("gNB", "UE"),
        ],
        "required_types": ["gNB", "AMF", "SMF", "UPF"],
    },
}

PROCESS_NAMES = list(PROCESS_DEFINITIONS.keys())


def create_flows(process_name, ue_count, topology, seed=None):
    """Create business flows for all UEs in a scenario."""
    if seed is not None:
        random.seed(seed)

    proc_def = PROCESS_DEFINITIONS[process_name]
    flows = []

    # Pre-select NE instances per UE
    for ue_idx in range(ue_count):
        ue_id = f"UE_{ue_idx + 1}"

        # Select one instance per required NE type (load balancing)
        selected = _select_ne_instances(proc_def, topology)

        # Build actual hops from the template
        actual_hops = []
        for src_type, dst_type in proc_def["hops"]:
            src_id = ue_id if src_type == "UE" else selected.get(src_type, src_type)
            dst_id = ue_id if dst_type == "UE" else selected.get(dst_type, dst_type)
            actual_hops.append((src_id, dst_id))

        flows.append(BusinessFlow(
            process_name=process_name,
            ue_id=ue_id,
            hops=actual_hops
        ))

    return flows


def _select_ne_instances(proc_def, topology):
    """Select one NE instance per required type using load balancing."""
    selected = {}

    for ne_type_str in proc_def["required_types"]:
        if ne_type_str in selected:
            continue

        # Handle handover special case: two gNBs
        if ne_type_str == "gNB_src":
            instances = topology.get_elements_by_type(NEType.gNB)
            chosen = random.choice(instances)
            selected["gNB_src"] = chosen.id
            # Pick a different one for target
            others = [i for i in instances if i.id != chosen.id]
            if not others:
                others = instances  # fallback if only one gNB
            selected["gNB_tgt"] = random.choice(others).id
            continue

        if ne_type_str == "gNB_tgt":
            if "gNB_tgt" not in selected:
                instances = topology.get_elements_by_type(NEType.gNB)
                selected["gNB_tgt"] = random.choice(instances).id
            continue

        ne_type = NEType[ne_type_str]
        instances = topology.get_elements_by_type(ne_type)

        if not instances:
            continue

        # For master/standby types, prefer master
        if ne_type in (NEType.UDM, NEType.AUSF):
            master = [i for i in instances if i.role == "master"]
            if master:
                selected[ne_type_str] = master[0].id
                continue

        selected[ne_type_str] = random.choice(instances).id

    return selected
