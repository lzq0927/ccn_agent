"""CHR generator: maps fault state to free5GC-faithful Call-History-Records.

For each sampled signaling transaction (one per UE / hop / timestamp, mirroring
the trace-KPI granularity), :class:`CHRGenerator` decides the outcome and the
5GMM/5GSM/SBI cause code. The outcome is driven by ``fault_hit`` — a flag the
engine computes with the *same* predicates used for trace-KPI degradation — so
KPI anomalies and CHR failures always point at the same set of affected hops.

Cause-code selection (diagnosis-relevant subset):

- resource_pool / dc / all_type_ne / multi_type_ne → SBI 429 + 5GMM CONGESTION(22)
- path_session → SBI 500 + 5GSM INSUFFICIENT_RESOURCES(67) / UNKNOWN_PDU_SESSION_TYPE(28)
- switch / path_link (link-layer transport) → SBI 503/504 + 5GSM NETWORK_FAILURE(38)
- LINK-mode NE fault → SBI 503/504 + 5GSM NETWORK_FAILURE(38)
- BUSINESS-mode NE fault → SBI 500; registration → 5GMM REGISTRATION_REJECT(2),
  session → 5GSM REQUEST_REJECTED(_UNSPECIFIED)

Deterministic: an internal RNG seeded by ``case_id`` makes CHR output reproducible.
"""

from __future__ import annotations

import random
from typing import Optional

from simulator.free5gc_types import Cause5GMM, Cause5GSM, SBIStatus
from simulator.models import CHRRecord, FaultMode, FaultPointType
from simulator.subscriber import PDUSession, SubscriberProfile

# Fault-point types whose dominant signature is congestion / overload.
_CONGESTION_TYPES = {
    FaultPointType.RESOURCE_POOL,
    FaultPointType.DC,
    FaultPointType.ALL_TYPE_NE,
    FaultPointType.MULTI_TYPE_NE,
}
# Fault-point types whose signature is a link-layer transport failure.
_LINK_TRANSPORT_TYPES = {FaultPointType.SWITCH, FaultPointType.PATH_LINK}

_PROCEDURES_WITH_SESSION = {
    "PDU_Session_Establishment",
    "PDU_Session_Release",
    "Service_Request",
    "Handover",
}


class CHRGenerator:
    """Generate free5GC-faithful CHR records, deterministic per ``case_id``."""

    def __init__(self, case_id: int, background_fail_rate: float = 0.001):
        self.case_id = case_id
        self.background_fail_rate = background_fail_rate
        self._rng = random.Random(case_id * 7919 + 101)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def emit(
        self,
        *,
        t: int,
        ue_id: str,
        subscriber: SubscriberProfile,
        session: Optional[PDUSession],
        procedure_type: str,
        msg_hop: str,
        nf_src: str,
        nf_dst: str,
        service: str,
        message_name: str,
        fault_active: bool,
        fault_hit: bool,
        fault_mode: Optional[FaultMode],
        fault_point_type: Optional[FaultPointType],
    ) -> CHRRecord:
        """Emit one CHR record for a sampled signaling transaction."""
        is_radio = nf_src == ue_id or nf_dst == ue_id  # UE-facing (radio/NAS) hop
        has_session = procedure_type in _PROCEDURES_WITH_SESSION

        base_latency = self._rng.uniform(8.0, 20.0)

        # Healthy hop: success, with a tiny SBI background-noise failure floor.
        if not fault_hit:
            if not is_radio and self._rng.random() < self.background_fail_rate:
                return self._record(
                    t,
                    ue_id,
                    subscriber,
                    session,
                    procedure_type,
                    msg_hop,
                    nf_src,
                    nf_dst,
                    service,
                    message_name,
                    is_radio,
                    has_session,
                    outcome="failure",
                    sbi=SBIStatus.INTERNAL_SERVER_ERROR,
                    cause5gmm=Cause5GMM.NONE,
                    cause5gsm=Cause5GSM.REQUEST_REJECTED_UNSPECIFIED,
                    latency=base_latency,
                )
            return self._record(
                t,
                ue_id,
                subscriber,
                session,
                procedure_type,
                msg_hop,
                nf_src,
                nf_dst,
                service,
                message_name,
                is_radio,
                has_session,
                outcome="success",
                sbi=SBIStatus.OK,
                cause5gmm=Cause5GMM.NONE,
                cause5gsm=Cause5GSM.NONE,
                latency=base_latency,
            )

        # Fault-affected hop: choose cause code by fault class.
        sbi, cause5gmm, cause5gsm = self._select_cause(fault_mode, fault_point_type, procedure_type)
        latency = base_latency * self._rng.uniform(3.0, 10.0)
        return self._record(
            t,
            ue_id,
            subscriber,
            session,
            procedure_type,
            msg_hop,
            nf_src,
            nf_dst,
            service,
            message_name,
            is_radio,
            has_session,
            outcome="failure",
            sbi=sbi,
            cause5gmm=cause5gmm,
            cause5gsm=cause5gsm,
            latency=latency,
        )

    # ------------------------------------------------------------------
    # Cause-code decision tree
    # ------------------------------------------------------------------
    def _select_cause(
        self,
        fault_mode: Optional[FaultMode],
        fpt: Optional[FaultPointType],
        procedure_type: str,
    ) -> tuple[SBIStatus, Cause5GMM, Cause5GSM]:
        if fpt in _CONGESTION_TYPES:
            return SBIStatus.TOO_MANY_REQUESTS, Cause5GMM.CONGESTION, Cause5GSM.NONE

        if fpt == FaultPointType.PATH_SESSION:
            cause = self._rng.choice(
                [Cause5GSM.INSUFFICIENT_RESOURCES, Cause5GSM.UNKNOWN_PDU_SESSION_TYPE]
            )
            return SBIStatus.INTERNAL_SERVER_ERROR, Cause5GMM.NONE, cause

        if fpt in _LINK_TRANSPORT_TYPES or fault_mode == FaultMode.LINK:
            sbi = self._rng.choice([SBIStatus.SERVICE_UNAVAILABLE, SBIStatus.GATEWAY_TIMEOUT])
            return sbi, Cause5GMM.NONE, Cause5GSM.NETWORK_FAILURE

        # BUSINESS mode (or unspecified): NF process fault.
        if procedure_type == "Registration":
            return (
                SBIStatus.INTERNAL_SERVER_ERROR,
                Cause5GMM.REGISTRATION_REJECT_GENERIC,
                Cause5GSM.NONE,
            )
        cause = self._rng.choice(
            [Cause5GSM.REQUEST_REJECTED_UNSPECIFIED, Cause5GSM.REQUEST_REJECTED]
        )
        return SBIStatus.INTERNAL_SERVER_ERROR, Cause5GMM.NONE, cause

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _record(
        self,
        t: int,
        ue_id: str,
        subscriber: SubscriberProfile,
        session: Optional[PDUSession],
        procedure_type: str,
        msg_hop: str,
        nf_src: str,
        nf_dst: str,
        service: str,
        message_name: str,
        is_radio: bool,
        has_session: bool,
        *,
        outcome: str,
        sbi: SBIStatus,
        cause5gmm: Cause5GMM,
        cause5gsm: Cause5GSM,
        latency: float,
    ) -> CHRRecord:
        # Radio/NAS hops are not SBI — carry no HTTP status; failures live in 5GMM.
        sbi_status = 0 if is_radio else sbi.value
        return CHRRecord(
            timestamp=t,
            supi=subscriber.supi,
            pdu_session_id=(session.pdu_session_id if (session and has_session) else None),
            procedure_type=procedure_type,
            msg_hop=msg_hop,
            nf_src=nf_src,
            nf_dst=nf_dst,
            service=service,
            sbi_status=sbi_status,
            outcome=outcome,
            cause5gmm=cause5gmm.value,
            cause5gsm=cause5gsm.value,
            latency_ms=round(latency, 2),
            message_name=message_name,
            ue_id=ue_id,
        )
