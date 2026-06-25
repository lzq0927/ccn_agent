"""free5GC-faithful subscriber / PDU-session identity model.

Replaces the synthetic ``UE_1..n`` labels with a real subscriber identity layer
(SUPI, IMSI, MSISDN, slice, DNN) and a PDU-session lifecycle, while keeping the
legacy ``ue_id`` as an internal join key so existing KPI/flow joins still work.

Deterministic: :class:`SubscriberRegistry` is seeded by ``case_id`` so the same
case always yields the same subscriber set.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Optional

from simulator.free5gc_types import Cause5GSM

# free5GC Test-network identity prefix: MCC=001, MNC=01 (Test PLMN).
# A 15-digit IMSI = prefix(5) + MSIN(10).
_IMSI_PREFIX = "00101"
_DEFAULT_DNN = "internet"
_DEFAULT_SLICE = (1, 0x010203)  # (SST, SD) — free5GC default Network Slice


@dataclass(frozen=True)
class SubscriberProfile:
    """A free5GC subscriber record (Nudm subscriber data view)."""

    supi: str  # "imsi-001010000000001"
    imsi: str  # 15-digit numeric
    msisdn: str  # "+8613800xxxxxxxx"
    dnn: str = _DEFAULT_DNN
    snssai: tuple[int, int] = _DEFAULT_SLICE
    pdu_session_type: str = "IPv4"
    subscriber_status: int = 0  # 0 normal, 1 operator-bared


@dataclass
class PDUSession:
    """A subscriber's PDU session and its lifecycle state."""

    pdu_session_id: int  # 1..15 per UE
    supi: str
    smf_instance: str = ""
    upf_instance: str = ""
    state: str = "none"  # none → establishing → active → releasing → released
    qfi: int = 9  # 5QI 9 = default non-GBR QoS
    dnn: str = _DEFAULT_DNN
    started_ts: int = 0
    ended_ts: Optional[int] = None
    cause5gsm: str = Cause5GSM.NONE.value


class SubscriberRegistry:
    """Deterministically generate ``ue_count`` subscribers for one case.

    Each ``ue_id`` (``UE_1..n``) is bound to a stable :class:`SubscriberProfile`
    and a :class:`PDUSession`, keyed by ``ue_id`` so callers can join CHR records
    back to the legacy KPI/flow identifiers.
    """

    def __init__(self, case_id: int, ue_count: int):
        self.case_id = case_id
        self.ue_count = ue_count
        self._rng = random.Random(case_id * 7919 + 13)
        self._subscribers: dict[str, SubscriberProfile] = {}
        self._sessions: dict[str, PDUSession] = {}
        self._build()

    def _build(self) -> None:
        for ue_idx in range(self.ue_count):
            ue_id = f"UE_{ue_idx + 1}"
            msin = self._rng.randint(0, 9_999_999_999)
            imsi = f"{_IMSI_PREFIX}{msin:010d}"
            profile = SubscriberProfile(
                supi=f"imsi-{imsi}",
                imsi=imsi,
                msisdn=f"+8613800{msin % 100_000_000:08d}",
            )
            self._subscribers[ue_id] = profile
            self._sessions[ue_id] = PDUSession(
                pdu_session_id=(ue_idx % 15) + 1,
                supi=profile.supi,
                dnn=_DEFAULT_DNN,
                started_ts=1,
            )

    def get(self, ue_id: str) -> Optional[SubscriberProfile]:
        return self._subscribers.get(ue_id)

    def session(self, ue_id: str) -> Optional[PDUSession]:
        return self._sessions.get(ue_id)

    @property
    def subscribers(self) -> list[SubscriberProfile]:
        return list(self._subscribers.values())

    @property
    def sessions(self) -> list[PDUSession]:
        return list(self._sessions.values())
