---
name: single_ne_fault
version: 1
category: core
fault_types: [single_ne]
applicable_modes: [workflow, guided, autonomous]
confidence_threshold: 0.6
last_updated: 2026-05-10
success_rate: 0.92
usage_count: 0
---

# Single NE Fault Diagnosis

## L0: Summary
Diagnose faults caused by a single network element failure. Look for one NE with consistently degraded KPIs across all its links and traces.

## L1: Full Procedure

### Indicators
- One specific NE ID appears in multiple degraded link pairs
- Degradation is symmetric: all links to/from this NE show similar loss rates
- Degradation is concentrated in time (fault window)
- Session KPIs for UEs routed through this NE are degraded

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find all degraded link pairs
2. Run `find_common_ne(degraded_links)` to identify NE appearing in most degraded pairs
3. Run `verify_temporal_pattern(ne_id)` to confirm sudden onset in fault window
4. Run `check_ue_impact(ne_id)` to confirm UEs routed through this NE are affected
5. Return diagnosis: fault_elements=[ne_id], fault_type=single_ne

### Decision Criteria
- Common NE appears in >80% of degraded link pairs → high confidence
- Temporal pattern matches (sudden onset, sustained, sudden recovery) → confirm
- UEs through this NE show degraded sessions while others do not → confirm

## L2: References

### Edge Cases
- If the faulty NE is UDM/AUSF in standby mode, impact may be minimal (master handles traffic)
- gNB faults affect UE-NE hops but not NE-NE hops
- Very low loss rates (3-4%) can be hard to distinguish from noise
- Load balancing dilutes impact: not all UE sessions go through the faulty NE

### Related Skills
- multi_ne_fault: when multiple NEs fail simultaneously
- resource_pool_fault: when all NEs in a pool fail (appears as multi_ne but correlated)
- normal_detection: when no clear anomaly exists
