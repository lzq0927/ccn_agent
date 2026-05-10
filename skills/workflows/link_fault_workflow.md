---
name: link_fault_workflow
version: 1
category: workflow
fault_types: [single_ne, multi_ne, all_type_ne]
applicable_modes: [workflow]
confidence_threshold: 0.7
last_updated: 2026-05-10
---

# Link Fault Diagnosis Workflow

## When to Use
High-confidence cases where KPI anomaly pattern clearly indicates a physical link failure affecting one or more NEs.

## Steps
1. `analyze_kpi_anomalies(level="link", threshold=0.995)` → Find all degraded link pairs
2. `find_common_ne(degraded_pairs)` → Identify NE with highest appearance in degraded pairs
3. `check_temporal_pattern(ne_id=top_ne)` → Verify fault window (sudden onset)
4. `check_ne_membership(ne_ids=[top_ne])` → Check spatial clustering
5. Classify fault type:
   - Single NE dominant (>40% of degraded pairs) → single_ne
   - Multiple NEs, same pool → resource_pool
   - Multiple NEs, same DC → dc
   - Multiple NEs, scattered → multi_ne
6. `submit_diagnosis(fault_elements, fault_type, confidence)`

## Decision Criteria
- NE appears in >80% of degraded pairs → high confidence (0.85+)
- Temporal pattern shows sudden onset → +0.1 confidence
- UE impact matches affected NE → +0.05 confidence
