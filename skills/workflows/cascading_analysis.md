---
name: cascading_analysis
version: 1
category: workflow
fault_types: [resource_pool, dc, multi_ne]
applicable_modes: [guided, autonomous]
confidence_threshold: 0.4
last_updated: 2026-05-10
---

# Cascading Fault Analysis

## When to Use
Complex scenarios where a primary fault may cascade to secondary effects, making it difficult to determine the true root cause.

## Steps
1. Full KPI analysis at all levels (link, trace, session)
2. Identify all degraded NEs and links
3. Build a fault impact graph: primary NE → affected links → secondary NEs
4. Use `check_ne_membership` to identify spatial patterns
5. Use temporal analysis to determine primary vs secondary effects:
   - Primary: degrades first, at fault injection time
   - Secondary: degrades slightly later, due to traffic rerouting
6. Check if load balancing is diluting the signal (not all UEs affected)
7. Determine if single-point fault with propagation vs true multi-point fault

## Key Insights
- Load balancing means not all UE sessions traverse the faulty NE
- A single NE fault can make it look like multiple NEs are affected
- The "star pattern" (all links through one NE) is the strongest single-NE indicator
