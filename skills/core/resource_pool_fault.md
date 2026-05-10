---
name: resource_pool_fault
version: 1
category: core
fault_types: [resource_pool]
applicable_modes: [workflow, guided]
confidence_threshold: 0.6
last_updated: 2026-05-10
success_rate: 0.85
usage_count: 0
---

# Resource Pool Fault Diagnosis

## L0: Summary
Diagnose faults where all NEs in one resource pool fail. Look for all NEs in a single pool showing degradation simultaneously.

## L1: Full Procedure

### Indicators
- All NEs in one resource pool show degraded KPIs
- NEs in other pools are unaffected
- All link pairs involving affected pool NEs show degradation
- Pattern is spatially clustered to one pool

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find degraded pairs
2. Run `find_all_degraded_nes(degraded_links)` to list affected NEs
3. Run `check_pool_membership(affected_nes)` to see if they share a pool
4. If all affected NEs belong to the same pool → resource_pool fault
5. Run `verify_temporal_pattern(affected_ne_ids)` to confirm concurrent onset
6. Return diagnosis: fault_elements=[all NE IDs in pool], fault_type=resource_pool

### Decision Criteria
- >80% of NEs in one pool are degraded → resource_pool
- No NEs outside that pool are affected → confirm
- Could be caused by switch failure (check switch_fault skill)

## L2: References

### Edge Cases
- Switch faults affect intra-pool links but not inter-pool links
- If only some NEs in a pool are affected, it's multi_ne, not resource_pool
- Resource pool fault and switch fault can look similar from KPI data alone
