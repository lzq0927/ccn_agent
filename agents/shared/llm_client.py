"""OpenAI-compatible LLM client with retry and fallback support."""

from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Literal, Optional

import httpx

logger = logging.getLogger(__name__)


@dataclass
class LLMConfig:
    provider: str = "openai"
    model: str = "gpt-4o"
    base_url: str = "https://api.openai.com/v1"
    api_key: str = ""
    api_key_env: str = "OPENAI_API_KEY"
    max_tokens: int = 4096
    temperature: float = 0.1
    timeout: int = 120
    mode: Literal["stub", "live", "auto"] = "auto"


def _resolve_mode(config: LLMConfig) -> Literal["stub", "live"]:
    """Resolve effective LLM mode.

    Priority: env CC_LIVE_LLM_MODE > explicit config.mode > auto-detect.
    `auto` returns "live" if OPENAI_API_KEY set, else "stub".
    """
    env_override = os.environ.get("CC_LIVE_LLM_MODE")
    if env_override in ("stub", "live"):
        return env_override  # type: ignore[return-value]
    if config.mode in ("stub", "live"):
        return config.mode  # type: ignore[return-value]
    if os.environ.get(config.api_key_env):
        return "live"
    return "stub"


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str  # JSON string


@dataclass
class LLMResponse:
    content: Optional[str] = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str = ""
    usage: dict = field(default_factory=dict)
    model: str = ""

    @property
    def has_tool_calls(self) -> bool:
        return len(self.tool_calls) > 0


@dataclass
class ToolSchema:
    name: str
    description: str
    parameters: dict  # JSON Schema


def _resolve_api_key(config: LLMConfig) -> str:
    if config.api_key:
        return config.api_key
    return os.environ.get(config.api_key_env, "")


def _parse_response(data: dict) -> LLMResponse:
    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content")
    tool_calls = []
    for tc in message.get("tool_calls", []):
        fn = tc.get("function", {})
        tool_calls.append(
            ToolCall(
                id=tc.get("id", ""),
                name=fn.get("name", ""),
                arguments=fn.get("arguments", "{}"),
            )
        )
    return LLMResponse(
        content=content,
        tool_calls=tool_calls,
        finish_reason=choice.get("finish_reason", ""),
        usage=data.get("usage", {}),
        model=data.get("model", ""),
    )


class LLMClient:
    """Async OpenAI-compatible chat completions client."""

    def __init__(self, config: LLMConfig | None = None):
        self.config = config or LLMConfig()
        self._client: httpx.AsyncClient | None = None

    async def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            api_key = _resolve_api_key(self.config)
            self._client = httpx.AsyncClient(
                base_url=self.config.base_url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(self.config.timeout, connect=10),
            )
        return self._client

    async def chat(
        self,
        messages: list[dict],
        tools: list[ToolSchema] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        retries: int = 3,
    ) -> LLMResponse:
        """Send a chat completion request."""
        client = await self._ensure_client()

        body: dict[str, Any] = {
            "model": self.config.model,
            "messages": messages,
            "max_tokens": max_tokens or self.config.max_tokens,
            "temperature": temperature if temperature is not None else self.config.temperature,
        }
        if tools:
            body["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]

        last_err = None
        for attempt in range(retries):
            try:
                resp = await client.post("/chat/completions", json=body)
                resp.raise_for_status()
                return _parse_response(resp.json())
            except httpx.HTTPStatusError as e:
                last_err = e
                if e.response.status_code == 429:
                    wait = min(2**attempt * 2, 30)
                    logger.warning("Rate limited, retrying in %ds", wait)
                    await asyncio.sleep(wait)
                elif e.response.status_code >= 500:
                    wait = min(2**attempt, 10)
                    logger.warning("Server error %d, retrying in %ds", e.response.status_code, wait)
                    await asyncio.sleep(wait)
                else:
                    raise
            except httpx.RequestError as e:
                last_err = e
                wait = min(2**attempt, 10)
                logger.warning("Request error: %s, retrying in %ds", e, wait)
                await asyncio.sleep(wait)

        raise RuntimeError(f"LLM request failed after {retries} retries: {last_err}")

    async def chat_simple(self, system: str, user: str, temperature: float = 0.1) -> str:
        """Simple chat interface that returns just the text content."""
        resp = await self.chat(
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            temperature=temperature,
        )
        return resp.content or ""

    async def close(self):
        if self._client and not self._client.is_closed:
            await self._client.aclose()
