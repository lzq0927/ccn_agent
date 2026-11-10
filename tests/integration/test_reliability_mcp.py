"""Real stdio protocol test, not an in-process registry mock."""

import json
import os
import sys

import pytest
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from reliability.store import ROOT, Store


@pytest.mark.asyncio
async def test_stdio_workflow_and_shared_storage(tmp_path):
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "reliability.mcp_server"], cwd=str(ROOT),
        env={**os.environ, "CCN_RELIABILITY_DATA": str(tmp_path)},
    )
    async with stdio_client(params) as (read, write), ClientSession(read, write) as session:
        await session.initialize()
        tools = (await session.list_tools()).tools
        assert {"knowledge_search", "design_validate", "simulation_run", "run_replay"} <= {
            tool.name for tool in tools}
        resources = await session.list_resources()
        assert any(str(r.uri) == "reliability://knowledge/model" for r in resources.resources)
        model = await session.read_resource("reliability://knowledge/model")
        assert json.loads(model.contents[0].text)["module"]["parent"] == "ai-systems"
        created = await session.call_tool("design_create", {"design": {"name": "MCP", "seeds": [42]}})
        assert not created.isError
        design = json.loads(created.content[0].text)
        assert Store(tmp_path).get_design(design["id"]) == design
        invalid = await session.call_tool("simulation_run", {"design_id": design["id"], "expected_revision": 5})
        assert invalid.isError
        evaluated = await session.call_tool("simulation_run", {"design_id": design["id"], "expected_revision": 1})
        assert not evaluated.isError
        run = json.loads(evaluated.content[0].text)
        assert run["result"]["summary"]["pdu_success_rate_delta"] == 0
        replay = await session.call_tool("run_replay", {"run_id": run["id"]})
        assert not replay.isError
        assert json.loads(replay.content[0].text)["result_hash"] == run["result_hash"]
