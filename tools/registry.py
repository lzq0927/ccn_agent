"""Self-registering tool registry for the fault perception agent.

Tools register themselves at import time. The registry collects schemas for
the LLM prompt and dispatches calls by name.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Coroutine, Optional

logger = logging.getLogger(__name__)

# Global registry singleton
_registry: dict[str, "ToolDefinition"] = {}


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict  # JSON Schema
    handler: Optional[Callable[..., Coroutine[Any, Any, str]]] = None
    toolset: str = "core"


def register(
    name: str,
    description: str,
    parameters: dict,
    handler: Optional[Callable[..., Coroutine[Any, Any, str]]] = None,
    toolset: str = "core",
):
    """Register a tool. Can be used as a decorator or called directly.

    When used as @register(...) decorator, the decorated function becomes the handler.
    When called directly with handler=..., it registers and returns the handler.
    """
    def _make_wrapper(fn):
        _registry[name] = ToolDefinition(
            name=name,
            description=description,
            parameters=parameters,
            handler=fn,
            toolset=toolset,
        )
        return fn

    if handler is not None:
        return _make_wrapper(handler)
    return _make_wrapper


def get_tool(name: str) -> ToolDefinition | None:
    return _registry.get(name)


def all_tools() -> dict[str, ToolDefinition]:
    return dict(_registry)


def schemas_for_prompt(toolset: str | None = None) -> list[dict]:
    """Return tool schemas formatted for LLM function calling."""
    result = []
    for name, tool in _registry.items():
        if toolset and tool.toolset != toolset:
            continue
        result.append({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        })
    return result


def schemas_as_tool_objects() -> list:
    """Return schemas as ToolSchema objects for LLMClient."""
    from agents.shared.llm_client import ToolSchema
    return [
        ToolSchema(name=t.name, description=t.description, parameters=t.parameters)
        for t in _registry.values()
    ]


async def dispatch(name: str, args: dict) -> str:
    """Dispatch a tool call by name."""
    tool = _registry.get(name)
    if not tool:
        return json.dumps({"error": f"Unknown tool: {name}"})
    if not tool.handler:
        return json.dumps({"error": f"Tool {name} has no handler"})
    try:
        result = await tool.handler(**args)
        return result
    except Exception as e:
        logger.exception("Tool %s failed", name)
        return json.dumps({"error": f"Tool {name} failed: {e}"}, ensure_ascii=False)


def import_all_tools() -> None:
    """Import all tool modules to trigger self-registration, then bind handlers."""
    import tools.kpi_analyzer          # noqa: F401
    import tools.topology_tools        # noqa: F401
    import tools.flow_tracer           # noqa: F401
    import tools.fault_isolator        # noqa: F401
    import tools.statistical_tools     # noqa: F401

    # Bind handlers: for any tool registered without a handler, look up the
    # async function with the same name in the imported module.
    import sys
    tool_modules = [
        tools.kpi_analyzer, tools.topology_tools, tools.flow_tracer,
        tools.fault_isolator, tools.statistical_tools,
    ]
    for name, tool_def in _registry.items():
        if tool_def.handler is None:
            for mod in tool_modules:
                fn = getattr(mod, name, None)
                if fn and callable(fn):
                    tool_def.handler = fn
                    break

    logger.info("Loaded %d tools", len(_registry))
