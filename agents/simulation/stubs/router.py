"""StubRouter: 加载预制 JSON,根据 agent+scenario_id 返回响应。"""
from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_STUB_DIR = Path(__file__).parent
_FALLBACK = {"fallback": "OK"}


class StubRouter:
    def __init__(self, agent: str, scenario_id: str):
        self.agent = agent
        self.scenario_id = scenario_id

    def respond(self, prompt: str) -> dict:
        path = _STUB_DIR / self.agent / f"{self.scenario_id}.json"
        if not path.exists():
            logger.warning("stub missing: %s", path)
            return _FALLBACK
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            logger.exception("stub load failed: %s", path)
            return _FALLBACK