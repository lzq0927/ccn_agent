# Exploration Mode — micro-loss / hidden-fault diagnosis

Use this mode when **KPIs look nearly normal but user-level CHR shows real
failures** — the signature of a micro-loss or hidden fault where terminal causes
or normal fluctuation would otherwise be indistinguishable from a genuine
network anomaly. Exploration runs a multi-algorithm framework (statistical + ML +
Bayesian) with parameter sweeps and cross-view ablation, then synthesises one
diagnosis.

## When exploration triggers (confidence assessor)
Any of:
- **Micro-loss band** — link anomalies exist but `anomaly_severity < 0.03`
  (LINK-mode loss under ~1%, invisible to the 0.995 KPI threshold).
- **User-level failure concentration** — failed-SUPI ratio in (2%, 30%), or
  per-SUPI failure Gini > 0.6 (a partial, targeted failure — not catastrophic,
  not noise).
- **Layer inconsistency** — link success rate looks healthy
  (`anomaly_ratio < 0.02`) yet CHR records SBI 5xx/429 failures.

CHR signal must exceed the ~0.1% background-noise floor (`chr_fail_rate > 0.3%`).

## Mandatory algorithm sequence
The `ParallelExplorer` orchestrates these; as the LLM synthesiser you interpret
the fused result.

1. **Locate onset** — `sweep_runner` over `ewma_changepoint` + `cusum_changepoint`
   on the `link_kpi` view. EWMA smooths noise; CUSUM is sensitive to small
   persistent drops. Param sweep over λ/threshold and drift_k/threshold_h.
2. **Candidate elements** — `pca_residual` (Q-statistic) + `isolation_forest`
   on the per-link feature matrix. Flag links/NEs that deviate structurally.
3. **CHR topology signature** — `ue_failure_concentration` (per-SUPI Gini +
   top failing NEs) + `correlated_failure_graph` (co-occurrence graph →
   single_ne star vs resource_pool/dc cluster vs multi_ne scatter) on the
   `chr_attempt` view.
4. **Fuse** — `bayesian_fusion` over all findings. Posterior rewards agreement
   across *independent* algorithms multiplicatively.
5. **Ablation** — leave-one-out: drop each algorithm, re-fuse. If dropping any
   single algorithm flips the top candidate, the result is fragile.

## Stop / accept criterion
Accept the top candidate when `posterior ≥ 0.6` **and** `≥ 2` independent
findings agree on it. If ablation flips the top, downgrade confidence by 0.15
and flag the uncertainty.

## Output contract
- `fault_elements` — the top posterior NE (or the largest correlated cluster).
- `fault_type` — derived from the CHR topology signature
  (`single_ne` / `resource_pool` / `dc` / `multi_ne`).
- `confidence` — the posterior, penalised if ablation is fragile.
- Reasoning trace records each `bayesian_fusion` result and ablation outcome.

## Key insight
CHR is *more* sensitive than the 0.995 KPI threshold: a mildly/indirectly
degraded hop can fail in CHR while its aggregate success rate stays just above
0.995. That headroom is exactly the signal exploration exploits to catch faults
the WORKFLOW/GUIDED heuristics miss.
