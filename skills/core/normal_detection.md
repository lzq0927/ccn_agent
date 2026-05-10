---
name: normal_detection
version: 1
category: core
fault_types: [normal]
applicable_modes: [workflow, guided, autonomous]
confidence_threshold: 0.8
last_updated: 2026-05-10
success_rate: 0.95
usage_count: 0
---

# Normal Case Detection

## L0: Summary
Identify cases where no fault is present. All KPI values should be within normal operating range.

## L1: Full Procedure

### Indicators
- No link pairs show significant degradation (success_rate consistently >0.99)
- No temporal anomaly pattern (no sudden drop in KPIs)
- All NEs appear equally healthy

### Diagnostic Steps
1. Run `analyze_kpi_anomalies(level="link", threshold=0.98)` to check for any degraded links
2. If no anomalies found at link level, check trace and session levels
3. Run `check_temporal_stability()` to verify no sudden changes
4. If all clear: return diagnosis: fault_elements=[], fault_type=normal

### Decision Criteria
- All link success rates >0.995 → normal with high confidence
- Minor fluctuations <0.5% → normal (noise)
- No temporal anomaly → confirm

## L2: References

### Edge Cases
- Very subtle faults (loss_rate ~3%) can appear nearly normal
- Intermittent faults may not manifest during the observation window
- Always double-check session-level KPIs before concluding normal
