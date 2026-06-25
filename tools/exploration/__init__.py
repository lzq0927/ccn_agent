"""Exploration-mode detector tools for Phase 2.

Statistical + ML detectors (EWMA/CUSUM change-point, PCA residual, Isolation
Forest), CHR-driven analysers (UE failure concentration, correlated-failure
graph), a Bayesian fusion tool, and a sweep_runner meta-tool. All self-register
via the decorator pattern in tools.registry.
"""
