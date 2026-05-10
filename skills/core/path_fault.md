---
name: path_fault
version: 1
category: core
fault_types: [path_link, path_trace, path_session]
applicable_modes: [guided, autonomous]
confidence_threshold: 0.4
last_updated: 2026-05-10
success_rate: 0.70
usage_count: 0
---

# Path-Level Fault Diagnosis

## L0: Summary
Diagnose faults at the path level: specific links, traces, or sessions are affected without a single NE being the root cause. These are the hardest to diagnose.

## L1: Full Procedure

### Indicators
- Specific link pairs or trace segments show degradation
- No single NE appears in all degraded pairs (unlike single_ne_fault)
- Degradation may affect only specific UE sessions (path_session)
- Pattern does NOT cluster by NE type, pool, or DC

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link")` to find degraded link pairs
2. Run `find_common_ne(degraded_links)` → no single NE dominates → path-level
3. Check if degraded links form a specific path (src→dst pattern)
4. Run `analyze_kpi_anomalies(level="trace")` to find degraded trace segments
5. Run `analyze_kpi_anomalies(level="session")` to find degraded UE sessions
6. Classify: path_link (specific links), path_trace (specific trace hops), path_session (specific UEs)
7. Return diagnosis with identified paths

### Decision Criteria
- Degraded links don't converge on any single NE → path-level
- Specific link pairs degraded → path_link
- Specific trace segments → path_trace
- Specific UE sessions → path_session

## L2: References

### Edge Cases
- Path faults may look like multi_ne if multiple NEs are involved in the paths
- Session-level faults affect only specific UEs' sessions
- These cases typically require autonomous agent exploration
