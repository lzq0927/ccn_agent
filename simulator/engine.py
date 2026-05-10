import random
from .models import (
    FaultConfig, FaultMode, FaultPointType, KPIRecord,
    SimulationResult, BusinessFlow
)
from .process import create_flows


class SimulationEngine:
    """Discrete event simulation engine for core network reliability."""

    def simulate(self, scenario):
        result = SimulationResult()

        # Step 1: Create UE flows
        flows = create_flows(
            scenario.process_name, scenario.ue_count,
            scenario.topology, seed=scenario.case_id * 1000
        )
        result.flows = flows

        # Step 2: Resolve path faults based on actual flows
        fc = scenario.fault_config
        if fc and fc.fault_point_type in (
            FaultPointType.PATH_LINK,
            FaultPointType.PATH_TRACE,
            FaultPointType.PATH_SESSION,
        ):
            self._resolve_path_fault(fc, flows)

        result.fault_config = fc

        # Step 3: Get unique NE-NE links from all flows
        unique_links = set()
        for flow in flows:
            for src, dst in flow.get_ne_hops():
                link = tuple(sorted([src, dst]))
                unique_links.add(link)

        # Step 4: Simulate 60 seconds
        for t in range(1, 61):
            fault_active = self._is_fault_active(fc, t)

            # 4a: Calculate link KPIs for each unique NE-NE link
            link_sr_cache = {}
            for link in unique_links:
                sr = self._calc_link_sr(link[0], link[1], fc, fault_active, t)
                link_sr_cache[link] = sr
                result.kpi_records.append(KPIRecord(
                    timestamp=t, level="link", ue_id="",
                    src=link[0], dst=link[1], success_rate=round(sr, 6)
                ))

            # 4b: Calculate trace and session KPIs for each flow
            for flow in flows:
                trace_srs = []
                for src, dst in flow.hops:
                    # Get base link SR
                    if src == flow.ue_id or dst == flow.ue_id:
                        # UE-NE hop: radio link with background noise
                        link_sr = 1.0 - random.uniform(0.001, 0.003)
                    else:
                        link_key = tuple(sorted([src, dst]))
                        link_sr = link_sr_cache.get(link_key, 0.997)

                    trace_sr = self._calc_trace_sr(
                        src, dst, flow.ue_id, link_sr, fc, fault_active, t
                    )
                    trace_srs.append(trace_sr)
                    result.kpi_records.append(KPIRecord(
                        timestamp=t, level="trace", ue_id=flow.ue_id,
                        src=src, dst=dst, success_rate=round(trace_sr, 6)
                    ))

                # Session KPI = product of all trace KPIs
                session_sr = 1.0
                for tsr in trace_srs:
                    session_sr *= tsr
                result.kpi_records.append(KPIRecord(
                    timestamp=t, level="session", ue_id=flow.ue_id,
                    src="", dst="", success_rate=round(session_sr, 6)
                ))

        return result

    def _is_fault_active(self, fc, t):
        if fc is None:
            return False
        return fc.fault_start <= t < fc.fault_start + fc.fault_duration

    def _calc_link_sr(self, src, dst, fc, fault_active, t):
        """Calculate link-level success rate between two NEs."""
        base_noise = random.uniform(0.001, 0.003)

        if not fault_active or fc is None:
            return 1.0 - base_noise

        # Direct link fault (path_link or switch)
        if self._is_link_affected(src, dst, fc):
            return self._fault_sr(fc.loss_rate)

        # NE fault in LINK mode affects all links to/from the NE
        if fc.fault_mode == FaultMode.LINK:
            if src in fc.affected_ne_ids or dst in fc.affected_ne_ids:
                return self._fault_sr(fc.loss_rate)

        return 1.0 - base_noise

    def _calc_trace_sr(self, src, dst, ue_id, link_sr, fc, fault_active, t):
        """Calculate trace-level success rate for a specific hop."""
        if not fault_active or fc is None:
            return link_sr

        # BUSINESS mode fault: NE fault affects trace but not link
        if fc.fault_mode == FaultMode.BUSINESS:
            if src in fc.affected_ne_ids or dst in fc.affected_ne_ids:
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6)

        # PATH_TRACE fault: specific trace segments are affected
        if fc.fault_point_type == FaultPointType.PATH_TRACE:
            if self._is_trace_affected(src, dst, ue_id, fc):
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6)

        # PATH_SESSION fault: specific sessions have degraded traces
        if fc.fault_point_type == FaultPointType.PATH_SESSION:
            if ue_id in fc.affected_sessions:
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6)

        # Indirect effect: NE communicating with a faulty NE
        # The trace success rate is slightly reduced due to retransmission/retry
        if fc.fault_mode == FaultMode.LINK:
            if self._communicates_with_affected(src, fc) or \
               self._communicates_with_affected(dst, fc):
                # Indirect impact is much smaller (diluted by load balancing)
                indirect_loss = fc.loss_rate * 0.1 + random.uniform(0, 0.002)
                return round(link_sr * (1.0 - indirect_loss), 6)

        return link_sr

    def _fault_sr(self, base_loss_rate):
        """Calculate fault-affected success rate with small random fluctuation."""
        noise = random.gauss(0, 0.005)
        loss = base_loss_rate + noise
        loss = max(0.01, min(0.15, loss))
        return round(1.0 - loss, 6)

    def _fault_loss(self, base_loss_rate):
        """Return a fluctuated loss rate."""
        noise = random.gauss(0, 0.005)
        return max(0.01, min(0.15, base_loss_rate + noise))

    def _is_link_affected(self, src, dst, fc):
        """Check if a specific link is in the affected links list."""
        for s, d in fc.affected_links:
            if (src == s and dst == d) or (src == d and dst == s):
                return True
        return False

    def _is_trace_affected(self, src, dst, ue_id, fc):
        """Check if a specific trace segment is affected."""
        for s, d in fc.affected_links:
            if (src == s and dst == d) or (src == d and dst == s):
                if ue_id in fc.affected_sessions:
                    return True
        return False

    def _communicates_with_affected(self, ne_id, fc):
        """Check if a NE communicates with any affected NE."""
        # Check through affected links
        for s, d in fc.affected_links:
            if ne_id == s or ne_id == d:
                return True
        # Check if NE is in same pool as affected NEs
        return False  # Simplified: indirect effect only through direct links

    def _resolve_path_fault(self, fc, flows):
        """Resolve path faults to specific links/sessions based on actual flows."""
        if fc.fault_point_type == FaultPointType.PATH_LINK:
            # Select random links from actual flows
            all_ne_hops = set()
            for flow in flows:
                for hop in flow.get_ne_hops():
                    all_ne_hops.add(tuple(sorted(hop)))

            hop_list = list(all_ne_hops)
            n = min(fc.num_affected_paths, len(hop_list))
            selected = random.sample(hop_list, n)
            fc.affected_links = selected

        elif fc.fault_point_type == FaultPointType.PATH_TRACE:
            # Select random traces (specific UE's specific hops)
            all_ne_hops = set()
            for flow in flows:
                for hop in flow.get_ne_hops():
                    all_ne_hops.add(tuple(sorted(hop)))

            hop_list = list(all_ne_hops)
            n = min(fc.num_affected_paths, len(hop_list))
            selected_hops = random.sample(hop_list, n)
            fc.affected_links = selected_hops

            # Select affected UEs
            ue_ids = [f.ue_id for f in flows]
            n_ue = min(random.randint(3, 8), len(ue_ids))
            fc.affected_sessions = set(random.sample(ue_ids, n_ue))

        elif fc.fault_point_type == FaultPointType.PATH_SESSION:
            # Select random sessions (UEs)
            ue_ids = [f.ue_id for f in flows]
            n = min(fc.num_affected_paths, len(ue_ids))
            fc.affected_sessions = set(random.sample(ue_ids, n))
