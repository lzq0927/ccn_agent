"""Native MCP stdio server used by OpenCode; stdout belongs to the protocol."""

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from reliability import catalog
from reliability.models import Design
from reliability.service import ReliabilityService
from reliability.solver import validate_design

READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=False)


def _run_summary(run: dict) -> dict:
    """Keep trajectories out of the planning context; run_get provides full evidence."""
    return {**{key: value for key, value in run.items() if key not in ("input", "result")},
            "result": {key: value for key, value in run["result"].items() if key != "trials"}}


def create_server(service: ReliabilityService | None = None) -> FastMCP:
    service = service or ReliabilityService()
    server = FastMCP("remap-ai-reliability", instructions=(
        "ReMAP AI 系统可靠性机制设计与仿真。先读 capabilities/knowledge，"
        "评估前核对 design_get 修订。所有动作仅作用于本地合成仿真。"
    ))

    @server.tool(annotations=READ)
    def reliability_capabilities() -> dict:
        """读取模块归属、OpenCode/Skill、已实现仿真域和数值边界。"""
        return catalog.capabilities()

    @server.tool(annotations=READ)
    def knowledge_search(query: str = "") -> dict:
        """检索版本化故障/机制/指标/证据及关系；空查询读取完整知识模型。"""
        return catalog.knowledge(query)

    @server.tool(annotations=READ)
    def scenario_list() -> dict:
        """列出真实可运行的合成场景与网元拓扑，设计机制前核对对象。"""
        return {"scenarios": catalog.scenarios(), "topology": catalog.topology()}

    @server.tool(annotations=READ)
    def design_list() -> dict:
        """发现本地方案 ID，不自动选择或修改任何方案。"""
        return {"items": service.store.list_designs()}

    @server.tool(annotations=READ)
    def design_get(design_id: str) -> dict:
        """读取完整方案和当前 revision；更新/评估前必须核对。"""
        return service.store.get_design(design_id)

    @server.tool(annotations=READ)
    def design_validate(design: Design) -> dict:
        """校验机制参数、目标网元与实验预算，不执行仿真。"""
        return {"valid": True, "warnings": validate_design(design)}

    @server.tool(annotations=WRITE)
    def design_create(design: Design) -> dict:
        """保存独立方案。建议不等于验证结果；原方案与既有实验不变。"""
        return service.create_design(design)

    @server.tool(annotations=WRITE)
    def design_update(design_id: str, expected_revision: int, design: Design) -> dict:
        """保存完整草稿，expected_revision 防止覆盖并发修改。"""
        return service.update_design(design_id, design, expected_revision)

    @server.tool(annotations=WRITE)
    def simulation_run(design_id: str, expected_revision: int) -> dict:
        """执行基线/候选机制的多种子 DES，冻结输入及模型版本并返回真实结果。"""
        return _run_summary(service.run(design_id, expected_revision))

    @server.tool(annotations=READ)
    def run_list(design_id: str) -> dict:
        """列出指定方案已完成实验摘要。"""
        return {"items": service.store.list_runs(design_id)}

    @server.tool(annotations=READ)
    def run_get(run_id: str) -> dict:
        """读取完整冻结输入、逐种子轨迹、指标和证据摘要。"""
        return service.store.get_run(run_id)

    @server.tool(annotations=WRITE)
    def run_replay(run_id: str) -> dict:
        """用原输入和种子生成新的重放实验；代码版本变化时拒绝重放。"""
        return _run_summary(service.replay(run_id))

    @server.tool(annotations=READ)
    def report_export(run_id: str) -> dict:
        """导出由保存实验生成的 Markdown 报告，包含指标定义与方法边界。"""
        return {"run_id": run_id, "format": "markdown", "content": service.report(run_id)}

    @server.resource("reliability://knowledge/model")
    def knowledge_model() -> dict:
        return catalog.knowledge()

    @server.resource("reliability://knowledge/boundaries")
    def method_boundaries() -> str:
        return catalog.boundaries()

    @server.resource("reliability://contracts/design")
    def design_schema() -> dict:
        return Design.model_json_schema()

    return server


def main():
    create_server().run(transport="stdio")


if __name__ == "__main__":
    main()
