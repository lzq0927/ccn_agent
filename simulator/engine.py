import random
from .models import FaultMode, FaultPointType, KPIRecord, SimulationResult
from .process import PROCESS_DEFINITIONS, create_flows
from .chr_generator import CHRGenerator
from .subscriber import SubscriberRegistry
from .nrf_view import enrich_topology


def _derive_service(message_name: str, src_type: str, dst_type: str) -> str:
    """Derive the SBI service name from a 3GPP message, else the hop type pair."""
    token = message_name.split()[0] if message_name else ""
    if token.startswith("N") and "_" in token:
        return token  # e.g. Nsmf_PDUSession_CreateSMContext
    return f"{src_type}->{dst_type}"  # radio/NAS hop, not SBI


class SimulationEngine:
    """Discrete event simulation engine for core network reliability."""

    def __init__(self, chr_background_fail_rate: float = 0.001):
        """``chr_background_fail_rate`` controls the rare healthy-hop SBI 5xx
        noise floor in CHR records (set to 0 for deterministic tests)."""
        self.chr_background_fail_rate = chr_background_fail_rate

    def simulate(self, scenario):
        result = SimulationResult()

        # Step 1: Create UE flows
        flows = create_flows(
            scenario.process_name, scenario.ue_count,
            scenario.topology, seed=scenario.case_id * 1000
        )
        result.flows = flows

        # Build the free5GC-faithful subscriber identity layer + CHR generator.
        registry = SubscriberRegistry(scenario.case_id, scenario.ue_count)
        chr_gen = CHRGenerator(scenario.case_id, self.chr_background_fail_rate)
        result.subscribers = registry.subscribers
        result.sessions = registry.sessions
        # Enrich topology with the NRF registration view (idempotent on a cache).
        enrich_topology(scenario.topology, scenario.case_id)

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
        proc_def = PROCESS_DEFINITIONS[scenario.process_name]
        for t in range(1, 61):
            fault_active = self._is_fault_active(fc, t)

            # 4a: Calculate link KPIs for each unique NE-NE link
            link_sr_cache = {}
            for link in unique_links:
                sr, link_hit = self._calc_link_sr(link[0], link[1], fc, fault_active, t)
                link_sr_cache[link] = (sr, link_hit)
                result.kpi_records.append(KPIRecord(
                    timestamp=t, level="link", ue_id="",
                    src=link[0], dst=link[1], success_rate=round(sr, 6)
                ))

            # 4b: Calculate trace and session KPIs (+ CHR) for each flow
            for flow in flows:
                subscriber = registry.get(flow.ue_id)
                session = registry.session(flow.ue_id)
                trace_srs = []
                for hop_idx, (src, dst) in enumerate(flow.hops):
                    # Get base link SR
                    if src == flow.ue_id or dst == flow.ue_id:
                        # UE-NE hop: radio link with background noise
                        link_sr = 1.0 - random.uniform(0.001, 0.003)
                        link_hit = False
                    else:
                        link_key = tuple(sorted([src, dst]))
                        link_sr, link_hit = link_sr_cache.get(link_key, (0.997, False))

                    trace_sr, trace_hit = self._calc_trace_sr(
                        src, dst, flow.ue_id, link_sr, link_hit, fc, fault_active, t
                    )
                    trace_srs.append(trace_sr)
                    result.kpi_records.append(KPIRecord(
                        timestamp=t, level="trace", ue_id=flow.ue_id,
                        src=src, dst=dst, success_rate=round(trace_sr, 6)
                    ))

                    # Emit free5GC-faithful CHR mirroring this trace hop, so KPI
                    # anomalies and CHR failures point at the same affected hops.
                    if subscriber is not None:
                        tmpl_src, tmpl_dst = proc_def["hops"][hop_idx]
                        message_name = proc_def["messages"][hop_idx]
                        result.chr_records.append(chr_gen.emit(
                            t=t, ue_id=flow.ue_id, subscriber=subscriber,
                            session=session, procedure_type=flow.process_name,
                            msg_hop=f"{tmpl_src}->{tmpl_dst}", nf_src=src, nf_dst=dst,
                            service=_derive_service(message_name, tmpl_src, tmpl_dst),
                            message_name=message_name, fault_active=fault_active,
                            fault_hit=(link_hit or trace_hit),
                            fault_mode=(fc.fault_mode if fc else None),
                            fault_point_type=(fc.fault_point_type if fc else None),
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
        """Calculate link-level success rate between two NEs.

        Returns ``(success_rate, fault_hit)`` where ``fault_hit`` is True iff the
        fault degraded this link — the CHR layer mirrors it for KPI↔CHR parity.
        """
        base_noise = random.uniform(0.001, 0.003)

        if not fault_active or fc is None:
            return 1.0 - base_noise, False

        # Direct link fault (path_link or switch)
        if self._is_link_affected(src, dst, fc):
            return self._fault_sr(fc.loss_rate), True

        # NE fault in LINK mode affects all links to/from the NE
        if fc.fault_mode == FaultMode.LINK:
            if src in fc.affected_ne_ids or dst in fc.affected_ne_ids:
                return self._fault_sr(fc.loss_rate), True

        return 1.0 - base_noise, False

    def _calc_trace_sr(self, src, dst, ue_id, link_sr, link_hit, fc, fault_active, t):
        """Calculate trace-level success rate for a specific hop.

        Returns ``(success_rate, fault_hit)``. ``link_hit`` indicates the
        underlying link was fault-degraded; a degraded link propagates to the
        trace so CHR and KPI stay consistent (e.g. LINK-mode NE faults).
        """
        if not fault_active or fc is None:
            return link_sr, False

        # BUSINESS mode fault: NE fault affects trace but not link
        if fc.fault_mode == FaultMode.BUSINESS:
            if src in fc.affected_ne_ids or dst in fc.affected_ne_ids:
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6), True

        # PATH_TRACE fault: specific trace segments are affected
        if fc.fault_point_type == FaultPointType.PATH_TRACE:
            if self._is_trace_affected(src, dst, ue_id, fc):
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6), True

        # PATH_SESSION fault: specific sessions have degraded traces
        if fc.fault_point_type == FaultPointType.PATH_SESSION:
            if ue_id in fc.affected_sessions:
                trace_loss = self._fault_loss(fc.loss_rate)
                return round(link_sr * (1.0 - trace_loss), 6), True

        # Indirect effect: NE communicating with a faulty NE
        # The trace success rate is slightly reduced due to retransmission/retry
        if fc.fault_mode == FaultMode.LINK:
            if self._communicates_with_affected(src, fc) or \
               self._communicates_with_affected(dst, fc):
                # Indirect impact is much smaller (diluted by load balancing)
                indirect_loss = fc.loss_rate * 0.1 + random.uniform(0, 0.002)
                return round(link_sr * (1.0 - indirect_loss), 6), True

        # Underlying link was fault-degraded (LINK-direct) — propagate to trace.
        return link_sr, link_hit

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
