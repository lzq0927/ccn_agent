from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Dict, List, Optional, Tuple
from enum import Enum

if TYPE_CHECKING:
    from simulator.subscriber import PDUSession, SubscriberProfile


class NEType(Enum):
    AMF = "AMF"
    SMF = "SMF"
    UPF = "UPF"
    PCF = "PCF"
    UDM = "UDM"
    AUSF = "AUSF"
    NRF = "NRF"
    NSSF = "NSSF"
    gNB = "gNB"


MASTER_STANDBY_TYPES = {NEType.UDM, NEType.AUSF}


class FaultMode(Enum):
    LINK = "link"
    BUSINESS = "business"


class FaultPointType(Enum):
    SINGLE_NE = "single_ne"
    MULTI_NE = "multi_ne"
    ALL_TYPE_NE = "all_type_ne"
    MULTI_TYPE_NE = "multi_type_ne"
    RESOURCE_POOL = "resource_pool"
    DC = "dc"
    PATH_LINK = "path_link"
    PATH_TRACE = "path_trace"
    PATH_SESSION = "path_session"
    SWITCH = "switch"
    NORMAL = "normal"


@dataclass
class NetworkElement:
    id: str
    ne_type: NEType
    pool_id: str
    dc_id: str
    role: str = "lb"  # 'master', 'standby', 'lb'
    # free5GC NRF registration view (enriched by simulator.nrf_view).
    nf_instance_id: str = ""          # NRF-registered instance id
    nf_set: Optional[str] = None      # NF set, e.g. "AMF-set"
    sbi_endpoint: str = ""            # e.g. "https://amf0.free5gc:8000"
    nf_status: str = "REGISTERED"     # REGISTERED | SUSPENDED | UNDISCOVERABLE

@dataclass
class ResourcePool:
    id: str
    dc_id: str
    elements: List[NetworkElement] = field(default_factory=list)

@dataclass
class DC:
    id: str
    pools: List[ResourcePool] = field(default_factory=list)

@dataclass
class Topology:
    dcs: List[DC]
    elements: Dict[str, NetworkElement] = field(default_factory=dict)
    switches: Dict[str, List[str]] = field(default_factory=dict)

    def get_elements_by_type(self, ne_type):
        return [ne for ne in self.elements.values() if ne.ne_type == ne_type]

    def get_elements_by_pool(self, pool_id):
        return [ne for ne in self.elements.values() if ne.pool_id == pool_id]

    def get_elements_by_dc(self, dc_id):
        return [ne for ne in self.elements.values() if ne.dc_id == dc_id]

    def get_pool_ids(self):
        ids = []
        for dc in self.dcs:
            for pool in dc.pools:
                ids.append(pool.id)
        return ids

    def get_dc_ids(self):
        return [dc.id for dc in self.dcs]


@dataclass
class FaultConfig:
    fault_point_type: FaultPointType
    fault_mode: FaultMode
    loss_rate: float
    fault_start: int
    fault_duration: int
    affected_ne_ids: set = field(default_factory=set)
    affected_links: List[Tuple[str, str]] = field(default_factory=list)
    # For path faults: how many paths to affect
    num_affected_paths: int = 1
    # For switch faults
    affected_switch: str = ""
    # Resolved affected sessions (UE IDs) for PATH_SESSION
    affected_sessions: set = field(default_factory=set)


@dataclass
class BusinessFlow:
    process_name: str
    ue_id: str
    hops: List[Tuple[str, str]]  # (actual_src_id, actual_dst_id)

    def get_ne_hops(self):
        """Return hops between NEs (excluding UE endpoints)."""
        return [(s, d) for s, d in self.hops if s != self.ue_id and d != self.ue_id]


@dataclass
class KPIRecord:
    timestamp: int
    level: str  # "link", "trace", "session"
    ue_id: str
    src: str
    dst: str
    success_rate: float


@dataclass
class CHRRecord:
    """A free5GC-faithful Call-History-Record: one sampled signaling transaction.

    Mirrors the per-UE/per-hop/per-timestamp granularity of trace KPIs so CHR and
    KPI failures point at the same set of affected hops. ``ue_id`` is kept as the
    legacy join key (UE_1..n); ``supi`` is the free5GC subscriber identity layer.
    """

    timestamp: int
    supi: str
    pdu_session_id: Optional[int]   # None for pure-registration (non-session) hops
    procedure_type: str             # e.g. "PDU_Session_Establishment"
    msg_hop: str                    # type-level hop text, e.g. "AMF->SMF"
    nf_src: str                     # concrete NE instance id (e.g. "AMF_1")
    nf_dst: str                     # concrete NE instance id
    service: str                    # SBI service, e.g. "Nsmf_PDUSession_CreateSMContext"
    sbi_status: int                 # SBIStatus value (200 on success)
    outcome: str                    # "success" | "failure"
    cause5gmm: str                  # Cause5GMM value ("0" = none)
    cause5gsm: str                  # Cause5GSM value ("0" = none)
    latency_ms: float
    message_name: str               # 3GPP message name from the process definition
    ue_id: str                      # legacy join key (UE_1..n)


@dataclass
class Scenario:
    case_id: int
    topology: Topology
    process_name: str
    ue_count: int
    fault_config: Optional[FaultConfig]
    is_normal: bool
    is_train: bool


@dataclass
class SimulationResult:
    kpi_records: List[KPIRecord] = field(default_factory=list)
    flows: List[BusinessFlow] = field(default_factory=list)
    fault_config: Optional[FaultConfig] = None
    # free5GC-faithful user-level layer (populated by CHRGenerator in the engine).
    chr_records: List[CHRRecord] = field(default_factory=list)
    subscribers: List["SubscriberProfile"] = field(default_factory=list)
    sessions: List["PDUSession"] = field(default_factory=list)
