import random
from .models import (
    Topology, DC, ResourcePool, NetworkElement,
    NEType, MASTER_STANDBY_TYPES
)

# 5 topology configurations: (num_dcs, pools_per_dc, ne_counts_by_type)
TOPOLOGY_CONFIGS = [
    # Small: 1 DC, 2 pools
    {
        "num_dcs": 1, "pools_per_dc": 2,
        "ne_counts": {
            NEType.gNB: (3, 5), NEType.AMF: (2, 3), NEType.SMF: (2, 3),
            NEType.UPF: (2, 3), NEType.PCF: (2, 3),
            NEType.UDM: (2, 2), NEType.AUSF: (2, 2),
            NEType.NRF: (2, 2), NEType.NSSF: (2, 2),
        }
    },
    # Medium-small: 1 DC, 3-4 pools
    {
        "num_dcs": 1, "pools_per_dc": (3, 4),
        "ne_counts": {
            NEType.gNB: (5, 8), NEType.AMF: (3, 5), NEType.SMF: (3, 5),
            NEType.UPF: (3, 5), NEType.PCF: (2, 3),
            NEType.UDM: (2, 2), NEType.AUSF: (2, 2),
            NEType.NRF: (2, 3), NEType.NSSF: (2, 3),
        }
    },
    # Medium: 2 DCs, 2-3 pools per DC
    {
        "num_dcs": 2, "pools_per_dc": (2, 3),
        "ne_counts": {
            NEType.gNB: (8, 12), NEType.AMF: (4, 8), NEType.SMF: (4, 8),
            NEType.UPF: (4, 8), NEType.PCF: (3, 5),
            NEType.UDM: (2, 2), NEType.AUSF: (2, 2),
            NEType.NRF: (3, 4), NEType.NSSF: (3, 4),
        }
    },
    # Medium-large: 2 DCs, 3-4 pools per DC
    {
        "num_dcs": 2, "pools_per_dc": (3, 4),
        "ne_counts": {
            NEType.gNB: (12, 18), NEType.AMF: (6, 12), NEType.SMF: (6, 12),
            NEType.UPF: (6, 12), NEType.PCF: (4, 6),
            NEType.UDM: (2, 2), NEType.AUSF: (2, 2),
            NEType.NRF: (4, 6), NEType.NSSF: (4, 6),
        }
    },
    # Large: 2 DCs, 4-5 pools per DC
    {
        "num_dcs": 2, "pools_per_dc": (4, 5),
        "ne_counts": {
            NEType.gNB: (16, 20), NEType.AMF: (10, 20), NEType.SMF: (10, 20),
            NEType.UPF: (10, 20), NEType.PCF: (6, 10),
            NEType.UDM: (2, 2), NEType.AUSF: (2, 2),
            NEType.NRF: (6, 10), NEType.NSSF: (6, 10),
        }
    },
]


class TopologyGenerator:
    def generate(self, config_index: int, seed=None):
        if seed is not None:
            random.seed(seed)

        config = TOPOLOGY_CONFIGS[config_index]
        num_dcs = config["num_dcs"]
        pools_per_dc = config["pools_per_dc"]
        if isinstance(pools_per_dc, tuple):
            pools_per_dc = random.randint(*pools_per_dc)

        # Generate pool IDs: [(dc_id, pool_id), ...]
        pool_info = []
        for dc_idx in range(num_dcs):
            dc_id = f"DC{dc_idx + 1}"
            for pool_idx in range(pools_per_dc):
                pool_id = f"RP_{dc_id}_{pool_idx + 1}"
                pool_info.append((dc_id, pool_id))

        total_pools = len(pool_info)

        # Generate all NEs
        elements = {}
        ne_counters = {t: 1 for t in NEType}

        for ne_type, (min_cnt, max_cnt) in config["ne_counts"].items():
            count = random.randint(min_cnt, max_cnt)

            if ne_type in MASTER_STANDBY_TYPES:
                self._gen_master_standby(
                    ne_type, count, pool_info, total_pools,
                    elements, ne_counters
                )
            else:
                for _ in range(count):
                    pool_idx = random.randint(0, total_pools - 1)
                    dc_id, pool_id = pool_info[pool_idx]
                    ne_id = f"{ne_type.value}_{ne_counters[ne_type]}"
                    ne_counters[ne_type] += 1
                    elements[ne_id] = NetworkElement(
                        id=ne_id, ne_type=ne_type,
                        pool_id=pool_id, dc_id=dc_id, role="lb"
                    )

        # Build DC -> Pool hierarchy
        dc_map = {}
        for dc_id, pool_id in pool_info:
            if dc_id not in dc_map:
                dc_map[dc_id] = DC(id=dc_id)
            pool = ResourcePool(id=pool_id, dc_id=dc_id)
            pool.elements = [ne for ne in elements.values() if ne.pool_id == pool_id]
            dc_map[dc_id].pools.append(pool)

        # Build switches (one per pool, connects all NEs in pool)
        switches = {}
        for dc_id, pool_id in pool_info:
            sw_id = f"SW_{pool_id}"
            switches[sw_id] = [ne.id for ne in elements.values() if ne.pool_id == pool_id]

        return Topology(
            dcs=list(dc_map.values()),
            elements=elements,
            switches=switches
        )

    def _gen_master_standby(self, ne_type, count, pool_info, total_pools,
                            elements, ne_counters):
        # Master and standby in different pools
        master_idx = random.randint(0, total_pools - 1)
        standby_candidates = [i for i in range(total_pools) if i != master_idx]
        standby_idx = random.choice(standby_candidates)

        for i, role in enumerate(["master", "standby"]):
            idx = master_idx if i == 0 else standby_idx
            dc_id, pool_id = pool_info[idx]
            ne_id = f"{ne_type.value}_{ne_counters[ne_type]}"
            ne_counters[ne_type] += 1
            elements[ne_id] = NetworkElement(
                id=ne_id, ne_type=ne_type,
                pool_id=pool_id, dc_id=dc_id, role=role
            )

        # Remaining instances as load-balanced
        for _ in range(count - 2):
            pool_idx = random.randint(0, total_pools - 1)
            dc_id, pool_id = pool_info[pool_idx]
            ne_id = f"{ne_type.value}_{ne_counters[ne_type]}"
            ne_counters[ne_type] += 1
            elements[ne_id] = NetworkElement(
                id=ne_id, ne_type=ne_type,
                pool_id=pool_id, dc_id=dc_id, role="lb"
            )
