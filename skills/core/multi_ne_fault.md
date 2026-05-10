---
name: multi_ne_fault
version: 1
category: core
fault_types: [multi_ne, multi_type_ne]
applicable_modes: [guided, autonomous]
confidence_threshold: 0.5
last_updated: 2026-05-10
success_rate: 0.78
usage_count: 0
---

# Multi-NE Fault Diagnosis

## L0: Summary
Diagnose faults caused by multiple network elements failing. Look for multiple NEs with degraded KPIs that are NOT spatially correlated (different pools/DCs/types).

## L1: Full Procedure

### Indicators
- Multiple NE IDs appear in degraded link pairs
- Degraded NEs span different resource pools or DCs (distinguishes from pool/DC faults)
- Each faulty NE shows similar degradation pattern independently
- Multiple NE types may be affected (multi_type_ne variant)

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find all degraded link pairs
2. Run `find_all_degraded_nes(degraded_links)` to list all affected NEs
3. Run `check_spatial_clustering(affected_nes)` to rule out pool/DC/type-level faults
4. If NEs are from different pools and different types → multi_ne
5. If NEs are all the same type but different pools → all_type_ne
6. Run `verify_temporal_pattern(ne_ids)` to confirm concurrent fault timing
7. Return diagnosis: fault_elements=[ne_ids], fault_type=multi_ne

### Decision Criteria
- Multiple NEs with no single spatial cluster → multi_ne
- All NEs are the same type → all_type_ne variant
- Temporal coincidence (all degrade at same time) → confirm multi-point fault

## L2: References

### Edge Cases
- Fault propagation can make single-point fault look like multi-point (check if one NE's failure causes another's degradation)
- With load balancing, affected NEs may show diluted impact
- Differentiate from resource_pool_fault: multi_ne affects NEs across pools

### Related Skills
- single_ne_fault: when only one NE is affected
- resource_pool_fault: when all NEs in one pool fail
- all_type_ne_fault: when all NEs of one type fail
