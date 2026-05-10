"""
Fault Data Generation Agent

OFFLINE design-time component that generates fault scenario data using the
simulator, performs self-verification via LLM, and creates hard cases for
challenging scenarios.

Pipeline:
1. Generate baseline cases using simulator
2. Self-verify generated cases via LLM
3. Generate hard cases (multi-fault, propagation, noise, boundary)
4. Write verified cases to CaseLibrary
"""

from .agent import FaultDataGenAgent

__all__ = ['FaultDataGenAgent']
