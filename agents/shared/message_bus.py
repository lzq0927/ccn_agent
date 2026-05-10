"""Async pub/sub message bus for inter-agent communication."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Callable, Coroutine

from agents.shared.models import AgentMessage

logger = logging.getLogger(__name__)

Handler = Callable[[AgentMessage], Coroutine[Any, Any, None]]


class MessageBus:
    """In-process async pub/sub message bus.

    Channels:
        data.generated        - Agent 1 publishes when cases are ready
        data.validation_failed - Agent 1 publishes validation failures
        perception.request    - Request for fault diagnosis
        perception.result     - Agent 2 publishes diagnosis results
        evaluation.request    - Request for evaluation
        evaluation.report     - Agent 3 publishes evaluation reports
        optimization.skill    - Skill improvement suggestions
        optimization.workflow - Workflow improvement suggestions
        optimization.cases    - New case suggestions for Agent 1
    """

    def __init__(self):
        self._subscribers: dict[str, list[Handler]] = {}
        self._queue: asyncio.Queue[AgentMessage] = asyncio.Queue()
        self._running = False
        self._task: asyncio.Task | None = None

    def subscribe(self, channel: str, handler: Handler) -> None:
        self._subscribers.setdefault(channel, []).append(handler)

    async def publish(self, channel: str, payload: dict, sender: str = "", correlation_id: str | None = None) -> str:
        msg = AgentMessage(
            message_id=uuid.uuid4().hex[:12],
            channel=channel,
            sender=sender,
            timestamp=datetime.now(timezone.utc).isoformat(),
            payload=payload,
            correlation_id=correlation_id,
        )
        await self._queue.put(msg)
        return msg.message_id

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._dispatch_loop())
        logger.info("MessageBus started")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("MessageBus stopped")

    async def _dispatch_loop(self) -> None:
        while self._running:
            try:
                msg = await asyncio.wait_for(self._queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            handlers = self._subscribers.get(msg.channel, [])
            for handler in handlers:
                try:
                    await handler(msg)
                except Exception:
                    logger.exception("Error in handler for channel %s", msg.channel)
