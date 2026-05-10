---
name: dc_fault
version: 1
category: core
fault_types: [dc]
applicable_modes: [workflow, guided]
confidence_threshold: 0.7
last_updated: 2026-05-10
success_rate: 0.90
usage_count: 0
---

# DC Fault Diagnosis

## L0: Summary
Diagnose faults where an entire DC fails. All NEs in one DC show degradation while the other DC's NEs remain healthy.

## L1: Full Procedure

### Indicators
- All NEs in one DC show degraded KPIs
- NEs in other DCs are unaffected
- Large-scale impact (30-70% of all NEs)
- Pattern clearly maps to DC boundary

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find degraded pairs
2. Run `find_all_degraded_nes(degraded_links)` to list affected NEs
3. Run `check_dc_membership(affected_nes)` to see if they share a DC
4. If all affected NEs belong to the same DC → dc fault
5. Verify other DC NEs are healthy
6. Return diagnosis: fault_elements=[all NE IDs in DC], fault_type=dc

### Decision Criteria
- All NEs in one DC degraded → dc fault
- No NEs in other DCs affected → confirm
- Very high impact ratio (30-70% of total NEs)
