"""Configuration for Phase 2 exploration mode (multi-algorithm framework).

Holds the default parameter sweep grids, parallelism cap, Bayesian fusion
prior, and the stop-rule / ablation thresholds. Defaults keep existing
WORKFLOW/GUIDED/AUTONOMOUS routing untouched — this only governs the
Route.EXPLORATION path.
"""

from __future__ import annotations

from dataclasses import dataclass, field


def _default_grids() -> dict[str, dict[str, list]]:
    """Per-detector default parameter grids for the sweep runner."""
    return {
        "ewma_changepoint": {"lambda_": [0.1, 0.2, 0.3], "threshold_sigma": [2.0, 3.0, 4.0]},
        "cusum_changepoint": {"drift_k": [0.005, 0.01, 0.02], "threshold_h": [4.0, 5.0, 6.0]},
        "pca_residual": {"n_components": [2, 3], "alpha": [0.05, 0.01]},
        "isolation_forest": {"n_estimators": [100, 200], "contamination": [0.05, 0.1]},
    }


@dataclass
class ExplorationConfig:
    """Tunables for the exploration orchestrator (ParallelExplorer)."""

    # Concurrency cap for parallel detector sweeps (avoids hammering tools/LLM).
    max_parallel_jobs: int = 8
    # Bayesian fusion false-positive base rate (lower → stronger agreement boost).
    base_rate: float = 0.1
    # Stop rule: accept the top candidate when its posterior ≥ this.
    min_posterior: float = 0.6
    # Stop rule: require at least this many independent findings to agree.
    min_agreement: int = 2
    # Ablation: if dropping any single algorithm flips the top candidate,
    # downgrade confidence by this and flag the uncertainty.
    ablation_flip_penalty: float = 0.15
    # If sklearn is unavailable, drop the ML detectors from the plan gracefully.
    use_sklearn_detectors: bool = True
    # Default per-detector param grids.
    grids: dict[str, dict[str, list]] = field(default_factory=_default_grids)

    def grid_for(self, algorithm: str) -> dict[str, list]:
        return self.grids.get(algorithm, {})
