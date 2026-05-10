# Fault Diagnosis Agent Memory

## Known Fault Patterns
- Single NE faults: star pattern degradation, one NE in >80% of degraded links
- Multi NE faults: scattered degradation, NEs from different pools
- Resource pool: all NEs in one pool degraded
- DC: all NEs in one DC degraded
- Switch: intra-pool links only, inter-pool healthy
- Path faults: specific links/traces affected, no NE convergence

## Diagnosis Strategies
- Start with link-level analysis, then drill into trace/session
- Check temporal pattern: sudden onset → sustained → sudden recovery = fault
- Load balancing dilutes impact: not all UE sessions traverse faulty NEs
- UDM/AUSF standby mode reduces impact of their failure

## Performance Notes
- Simple single_ne and normal cases can use workflow path (no LLM needed)
- Multi_ne and path faults typically require agent exploration
- Confidence threshold 0.7 for workflow, 0.3 for autonomous
