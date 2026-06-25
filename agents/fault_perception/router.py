"""Router: dispatches diagnosis to workflow, guided, or autonomous path."""

from __future__ import annotations

import logging

from agents.shared.models import ConfidenceAssessment, Route

logger = logging.getLogger(__name__)


class Router:
    """Routes case data to the appropriate processing path based on confidence assessment."""

    def route(self, assessment: ConfidenceAssessment) -> dict:
        return {
            "route": assessment.route,
            "workflow": assessment.suggested_workflow,
            "skills": assessment.suggested_skills,
            "max_iterations": {
                Route.WORKFLOW: 5,
                Route.GUIDED: 15,
                Route.AUTONOMOUS: 30,
                Route.EXPLORATION: 40,
            }[assessment.route],
        }
