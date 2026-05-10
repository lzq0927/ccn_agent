# Fault Diagnosis Skill Index

| Skill | Category | Fault Types | When to Use | Success Rate |
|-------|----------|-------------|-------------|--------------|
| single_ne_fault | core | single_ne | One NE with broad degradation | 0.92 |
| multi_ne_fault | core | multi_ne, multi_type_ne | Multiple unrelated NEs degraded | 0.78 |
| all_type_ne_fault | core | all_type_ne | All NEs of one type degraded | 0.88 |
| resource_pool_fault | core | resource_pool | All NEs in one pool degraded | 0.85 |
| dc_fault | core | dc | All NEs in one DC degraded | 0.90 |
| path_fault | core | path_link, path_trace, path_session | Specific paths degraded, no single NE | 0.70 |
| switch_fault | core | switch | All intra-pool links degraded | 0.82 |
| normal_detection | core | normal | No significant anomalies found | 0.95 |
| link_fault_workflow | workflow | (LINK mode) | Physical link failure workflow | 0.88 |
| business_fault_workflow | workflow | (BUSINESS mode) | Business-level fault workflow | 0.80 |
| cascading_analysis | workflow | (complex) | Cascading fault analysis | 0.65 |
