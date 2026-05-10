"""
Fault Perception Agent - Online production component for fault root cause localization.
Receives real-time KPI time series and outputs fault localization results with confidence ratings.
"""

from agents.fault_perception.agent import FaultPerceptionAgent

__all__ = ["FaultPerceptionAgent"]
__version__ = "1.0.0"
