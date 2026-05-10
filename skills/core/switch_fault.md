---
name: switch_fault
version: 1
category: core
fault_types: [switch]
applicable_modes: [guided, autonomous]
confidence_threshold: 0.5
last_updated: 2026-05-10
success_rate: 0.82
usage_count: 0
---

# Switch Fault Diagnosis

## L0: Summary
Diagnose faults caused by a switch failure in a resource pool. Affects all intra-pool communication between NEs, but NE-to-NE links outside the pool are unaffected.

## L1: Full Procedure

### Indicators
- All intra-pool links degraded (NEs within same pool communicating)
- Inter-pool links are NOT degraded (NEs across pools are fine)
- NE-to-NE links within the pool fail, but each NE's external links work
- Pattern is subtle: individual NEs appear healthy from external links

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find degraded pairs
2. Identify if degraded pairs are exclusively intra-pool
3. Run `check_intra_pool_links(pool_id)` for each pool
4. If one pool shows all intra-pool links degraded but no inter-pool impact → switch fault
5. Return diagnosis: fault_elements=[switch_id], fault_type=switch

### Decision Criteria
- Degraded links are all within one pool → switch fault
- No inter-pool degradation → distinguish from resource_pool fault
- The switch connects all NEs in the pool
