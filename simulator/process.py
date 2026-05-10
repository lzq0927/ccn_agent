import random
from .models import NEType, BusinessFlow

# 5 business process definitions
# Each hop is (src_type, dst_type, message_name); "UE" is the user equipment endpoint
# Message names follow 3GPP TS 24.501 / TS 23.502
PROCESS_DEFINITIONS = {
    "PDU_Session_Establishment": {
        "description": "PDU会话建立 (3GPP TS 23.502)",
        "hops": [
            ("UE", "gNB", "ULInformationTransfer / PDU Session Establishment Request"),
            ("gNB", "AMF", "InitialUEMessage (NAS-PDU)"),
            ("AMF", "SMF", "Nsmf_PDUSession_CreateSMContext Request"),
            ("SMF", "UDM", "Nudm_SDM_Get / PDU Session Subscription Data"),
            ("UDM", "SMF", "Nudm_SDM_Get Response"),
            ("SMF", "PCF", "Npcf_SMPolicyControl_Create Request"),
            ("PCF", "SMF", "Npcf_SMPolicyControl_Create Response"),
            ("SMF", "UPF", "N4 Session Establishment Request"),
            ("UPF", "SMF", "N4 Session Establishment Response"),
            ("SMF", "AMF", "Nsmf_PDUSession_CreateSMContext Response"),
            ("AMF", "gNB", "DL NAS Transport / PDU Session Establishment Accept"),
            ("gNB", "UE", "DLInformationTransfer / PDU Session Establishment Accept"),
        ],
        "required_types": ["gNB", "AMF", "SMF", "UDM", "PCF", "UPF"],
    },
    "Registration": {
        "description": "注册流程 (3GPP TS 23.502)",
        "hops": [
            ("UE", "gNB", "ULInformationTransfer / Registration Request"),
            ("gNB", "AMF", "InitialUEMessage (NAS-PDU)"),
            ("AMF", "AUSF", "Nausf_UEAuthentication_Authenticate Request"),
            ("AUSF", "UDM", "Nudm_Authentication / Get Auth Data"),
            ("UDM", "AUSF", "Nudm_Authentication Response / Auth Data"),
            ("AUSF", "AMF", "Nausf_UEAuthentication_Authenticate Response"),
            ("AMF", "UDM", "Nudm_SDM_Get / Subscribe Data"),
            ("UDM", "AMF", "Nudm_SDM_Get Response"),
            ("AMF", "gNB", "DL NAS Transport / Registration Accept"),
            ("gNB", "UE", "DLInformationTransfer / Registration Accept"),
        ],
        "required_types": ["gNB", "AMF", "AUSF", "UDM"],
    },
    "Handover": {
        "description": "切换流程 (3GPP TS 23.502)",
        "hops": [
            ("UE", "gNB_src", "ULInformationTransfer / Measurement Report"),
            ("gNB_src", "AMF", "Handover Required"),
            ("AMF", "SMF", "Nsmf_PDUSession_UpdateSMContext Request"),
            ("SMF", "UPF", "N4 Session Modification Request"),
            ("UPF", "SMF", "N4 Session Modification Response"),
            ("SMF", "AMF", "Nsmf_PDUSession_UpdateSMContext Response"),
            ("AMF", "gNB_tgt", "Handover Request"),
            ("gNB_tgt", "AMF", "Handover Request Acknowledge"),
            ("AMF", "gNB_src", "Handover Command"),
            ("gNB_src", "UE", "RRC / Handover Command"),
            ("UE", "gNB_tgt", "RRC / Handover Complete"),
        ],
        "required_types": ["gNB_src", "gNB_tgt", "AMF", "SMF", "UPF"],
    },
    "PDU_Session_Release": {
        "description": "PDU会话释放 (3GPP TS 23.502)",
        "hops": [
            ("UE", "gNB", "ULInformationTransfer / PDU Session Release Request"),
            ("gNB", "AMF", "InitialUEMessage (NAS-PDU)"),
            ("AMF", "SMF", "Nsmf_PDUSession_ReleaseSMContext Request"),
            ("SMF", "UPF", "N4 Session Release Request"),
            ("UPF", "SMF", "N4 Session Release Response"),
            ("SMF", "PCF", "Npcf_SMPolicyControl_Update Request"),
            ("PCF", "SMF", "Npcf_SMPolicyControl_Update Response"),
            ("SMF", "AMF", "Nsmf_PDUSession_ReleaseSMContext Response"),
            ("AMF", "gNB", "DL NAS Transport / PDU Session Release Command"),
            ("gNB", "UE", "DLInformationTransfer / PDU Session Release Command"),
        ],
        "required_types": ["gNB", "AMF", "SMF", "UPF", "PCF"],
    },
    "Service_Request": {
        "description": "服务请求 (3GPP TS 23.502)",
        "hops": [
            ("UE", "gNB", "ULInformationTransfer / Service Request"),
            ("gNB", "AMF", "InitialUEMessage (NAS-PDU)"),
            ("AMF", "SMF", "Nsmf_PDUSession_UpdateSMContext Request"),
            ("SMF", "UPF", "N4 Session Modification Request"),
            ("UPF", "SMF", "N4 Session Modification Response"),
            ("SMF", "AMF", "Nsmf_PDUSession_UpdateSMContext Response"),
            ("AMF", "gNB", "DL NAS Transport / Service Accept"),
            ("gNB", "UE", "DLInformationTransfer / Service Accept"),
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
        for hop in proc_def["hops"]:
            src_type, dst_type, _ = hop
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
