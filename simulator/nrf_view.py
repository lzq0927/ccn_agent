"""free5GC NRF-style enrichment of the synthetic topology.

Adds an NRF (Network Repository Function) registration view to each
:class:`NetworkElement`: an NF instance id, an SBI endpoint, and a default
``REGISTERED`` status. This is *static* metadata only — dynamic, fault-driven
status (an NE going down) is carried in the CHR stream as SBI 5xx responses,
not in the topology.

Deterministic and idempotent: safe to call repeatedly on a shared/cached
topology (the wrapper caches topologies across cases).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from simulator.models import Topology


def enrich_topology(topology: "Topology", case_id: int = 0) -> "Topology":
    """Fill NRF-view fields (nf_instance_id, sbi_endpoint, nf_status) in place.

    Only enriches NEs whose ``nf_instance_id`` is still empty, so repeated calls
    on a cached topology are no-ops.
    """
    for ne in topology.elements.values():
        if ne.nf_instance_id:
            continue  # already enriched (idempotent)

        type_val = ne.ne_type.value
        ne.nf_instance_id = ne.id  # NRF instance id mirrors the NE id
        if type_val == "gNB":
            ne.sbi_endpoint = ""  # gNB is not an SBI NF (NG-AP over N2)
            ne.nf_set = None
        else:
            ne.sbi_endpoint = f"https://{ne.id.lower()}.free5gc:8000"
            ne.nf_set = f"{type_val}-set"
        ne.nf_status = "REGISTERED"
    return topology
