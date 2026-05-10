---
name: business_fault_workflow
version: 1
category: workflow
fault_types: [single_ne, multi_ne]
applicable_modes: [workflow, guided]
confidence_threshold: 0.6
last_updated: 2026-05-10
---

# Business Fault Diagnosis Workflow

## When to Use
Cases where business-level KPIs (trace/session) are degraded but link-level KPIs appear normal.

## Steps
1. `analyze_kpi_anomalies(level="trace", threshold=0.995)` → Find degraded trace segments
2. `analyze_kpi_anomalies(level="session", threshold=0.995)` → Find degraded UE sessions
3. `analyze_kpi_anomalies(level="link", threshold=0.995)` → Confirm link level is NOT affected
4. If link level is normal but trace/session are degraded → BUSINESS mode fault
5. `find_common_ne(degraded_trace_pairs)` → Identify affected NE from trace data
6. `trace_ue_impact(ne_id)` → Verify UE sessions through affected NE are degraded
7. `submit_diagnosis(fault_elements, fault_type, fault_mode="business")`

## Key Differentiators
- BUSINESS mode faults: link KPI normal, trace/session KPI degraded
- LINK mode faults: all KPI levels show degradation
- This distinction is critical for correct fault mode classification
