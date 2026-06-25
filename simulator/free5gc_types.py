"""free5GC-faithful cause-code enumerations for 5GC fault simulation.

These model the real failure-cause vocabularies a 5GC produces, so generated
Call-History-Record (CHR) events carry diagnosis-meaningful reason codes:

- ``Cause5GMM`` : 5GMM (NAS mobility management) cause codes — TS 24.501 §9.11.3.2
- ``Cause5GSM`` : 5GSM (session management) cause codes     — TS 24.501 §9.11.4.2
- ``SBIStatus`` : HTTP/2 SBI transport status between Network Functions

Only a *diagnosis-relevant subset* of the TS catalogs is modelled. The synthetic
value ``"0"`` (``NONE``) means "no cause / success" and is not a real 5GMM/5GSM
value — it exists purely so success events can carry an explicit "no failure".
"""

from __future__ import annotations

from enum import Enum


class Cause5GMM(str, Enum):
    """5GMM cause codes (TS 24.501 §9.11.3.2). ``NONE`` = no cause (synthetic)."""

    NONE = "0"
    REGISTRATION_REJECT_GENERIC = "2"  # AMF generic reject (Registration)
    ILLEGAL_UE = "3"
    ILLEGAL_ME = "6"
    PLMN_NOT_ALLOWED = "11"
    CONGESTION = "22"  # AMF/SMF overload (resource_pool / dc faults)
    LADN_UNAVAILABLE = "43"  # session-establishment path fault
    NO_NETWORK_SLICE_AVAILABLE = "62"
    MAX_PDU_SESSIONS_REACHED = "65"
    INSUFFICIENT_RESOURCES = "67"  # AMF capacity exhaustion


class Cause5GSM(str, Enum):
    """5GSM cause codes (TS 24.501 §9.11.4.2). ``NONE`` = no cause (synthetic)."""

    NONE = "0"
    REQUEST_REJECTED = "26"  # BUSINESS-mode session reject
    MISSING_OR_UNKNOWN_DNN = "27"
    UNKNOWN_PDU_SESSION_TYPE = "28"
    REQUEST_REJECTED_UNSPECIFIED = "31"  # generic SMF reject (BUSINESS mode)
    REGULAR_DEACTIVATION = "36"  # NE fault forcing session release
    NETWORK_FAILURE = "38"  # N4 / SBI transport failure (LINK mode)
    PDU_SESSION_DOES_NOT_EXIST = "39"  # release path
    INSUFFICIENT_RESOURCES = "67"  # UPF/SMF resource exhaustion


class SBIStatus(int, Enum):
    """HTTP/2 SBI transport status codes between Network Functions."""

    OK = 200
    CREATED = 201
    BAD_REQUEST = 400
    UNAUTHORIZED = 401
    FORBIDDEN = 403
    NOT_FOUND = 404
    REQUEST_TIMEOUT = 408  # NRF / heartbeat timeout — link / transport fault
    CONFLICT = 409
    TOO_MANY_REQUESTS = 429  # congestion — overload (resource_pool / dc)
    INTERNAL_SERVER_ERROR = 500  # NF process fault (BUSINESS mode)
    SERVICE_UNAVAILABLE = 503  # NE down / NRF deregistration
    GATEWAY_TIMEOUT = 504  # upstream NF timeout


# Convenience: 5xx status codes that signal a real NF/transport failure.
SBI_FAILURE_STATUSES = {
    SBIStatus.REQUEST_TIMEOUT,
    SBIStatus.TOO_MANY_REQUESTS,
    SBIStatus.INTERNAL_SERVER_ERROR,
    SBIStatus.SERVICE_UNAVAILABLE,
    SBIStatus.GATEWAY_TIMEOUT,
}
