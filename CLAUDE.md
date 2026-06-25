# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

`ccn-agent` 是一个 **5GC(5G 核心网)故障诊断闭环系统**:LLM Agent 接收仿真生成的故障遥测数据(KPI 时序 + 拓扑 + 业务流),诊断出根因故障,再将诊断准确率反馈到数据生成环节。系统由三个 Agent 构成闭环。完整的模块清单见 `docs/architecture.md` 和 `docs/agent_guide.md` —— 想看完整文件目录就读这两个文档;本文件只讲操作要点、核心概念以及容易踩坑的地方。

> 注意:`顶层设计/` 文件夹**不是**系统架构。它记录的是「一支 Claude Code Agent 团队应如何协作开发本项目」(角色矩阵、协作协议、任务流程)。请把它当作开发流程指引,而非运行时行为。

## 常用命令

```bash
# 安装(可编辑模式,带开发工具)
pip install -e ".[dev]"

# 代码检查 —— line-length 100,target py311(见 pyproject.toml)
ruff check .

# 单独运行各 Agent
python -m agents.data_generation.agent --count 10 --seed 42      # Agent 1:生成用例
python -m agents.fault_perception.agent --case-id 1 --data-dir ./data   # Agent 2:诊断单个用例
python -m agents.evaluation.agent --evaluate-all                # Agent 3:评估全部诊断结果

# 完整闭环(生成 → 诊断 → 评估)—— 跑系统的主入口
python -m agents.closed_loop --cases 10 --iterations 1 --seed 42

# 仅仿真管线(写原始 data/ 目录,不入库)
python -m simulator.main

# API 服务(FastAPI)
uvicorn api.app:app --reload --port 8000

# 前端(React + Vite)
cd frontend && npm install && npm run dev
```

测试已在 `pyproject.toml` 中配置(`testpaths = ["tests"]`、`asyncio_mode = "auto"`),但**目前没有 `tests/` 目录** —— `pytest` 会一个用例都找不到。新增测试时,跑单个文件用 `pytest tests/test_foo.py`,跑单个用例用 `pytest tests/test_foo.py::test_name`。

## 配置与 LLM

- 所有 LLM 调用都走 `agents/shared/llm_client.py` —— 一个 **OpenAI 兼容**的异步客户端(改 `base_url` 即可对接 OpenAI、OpenRouter 或本地 Ollama)。尽管 `openai` 是依赖,但这里**没有**用官方 `openai` SDK。
- `config/default.yaml` —— 系统配置(存储路径、阈值、Agent 参数)。
- `config/llm.yaml` —— provider/模型定义。**复制为 `config/llm.local.yaml`**(已 gitignore)并在其中填 key,或用环境变量。默认 key 环境变量:`OPENAI_API_KEY`。
- 运行时状态写入 `./storage/`(SQLite + 用例文件)和 `./data/`(仿真原始输出);两者均 gitignore,由仿真器重新生成。

## 架构:三 Agent 闭环

系统由 `agents/closed_loop.py`(`ClosedLoopRunner`)编排三个 Agent,每个 Agent 各自掌管一个环路:

1. **Agent 1 —— 数据生成**(`agents/data_generation/`,设计态):运行离散事件 `simulator/` 生成故障用例,再用 LLM *校验器*从多个维度检查每个用例。校验失败则调整参数重试(自校验闭环)。输出:`CasePackage` 对象,落盘到 `storage/cases/case_XXX/`。

2. **Agent 2 —— 故障感知**(`agents/fault_perception/`,运行态):系统核心。通过**基于置信度的路由**把诊断任务导向三条执行路径之一,返回带完整推理链的 `DiagnosisResult`。

3. **Agent 3 —— 评估优化**(`agents/evaluation/`,设计态):把每个 `DiagnosisResult` 与真值比对(精确匹配、P/R/F1),分析推理链质量,构建案例库,产出 `OptimizationSuggestion`。这些反馈回 Agent 1(新增难例)和 Agent 2(Skill 更新)。

Agent 之间通过异步发布/订阅的 `MessageBus`(`agents/shared/message_bus.py`)通信,通过 `Storage` SQLite 层共享状态。

## 核心心智模型:Agent 2 的路由 + Hermes 风格 Loop

Agent 2 借鉴了 Hermes Agent 的设计模式(Agent Loop、工具自注册、Skill 渐进式披露、Memory)。在本仓库干活,关键是搞懂下面四件事:

**基于置信度的路由**(`agents/fault_perception/confidence.py`):一个规则式 `ConfidenceAssessor` 从 KPI 数据提取特征(异常严重度、空间/时间清晰度、NE 主导度),与已知故障签名比对,算出 0–1 的分数。分数决定路由:
- `> 0.7` → **WORKFLOW**:`WorkflowEngine` 里的确定性固定步骤(不走 LLM Agent Loop —— 直接调工具)。
- `0.3–0.7` → **GUIDED**:Agent Loop,并在 prompt 里注入匹配度最高的 2 个 Skill 文档。
- `≤ 0.3` → **AUTONOMOUS**:完整 Agent Loop + 并行探索。

> **坑:**阈值 `0.7`/`0.3` 是**硬编码的模块常量**(`confidence.py` 里的 `THRESHOLD_HIGH`/`THRESHOLD_LOW`),**并不**从 `PerceptionConfig` 或 `config/default.yaml` 读取。配置字段存在但没接通。要调阈值请改这两个常量。

**Agent Loop**(`FaultPerceptionAgent._run_agent_loop`):标准的 `prompt → LLM → 工具调用 → 循环`,带迭代次数上限。Loop 只有在 LLM 调用 `submit_diagnosis` 时才终止。`submit_diagnosis` 是**在 `agent.py` 里注入的伪工具** —— 它**不在**工具注册表中。

**工具自注册**(`tools/registry.py`):每个工具模块在 import 时调用 `register(name=..., description=..., parameters={JSON schema}, handler=<async fn>)`。`FaultPerceptionAgent.__init__` 调用 `import_all_tools()`,后者 import 这些模块以触发注册,并按同名函数绑定 handler。**新增工具:**定义一个返回 JSON 字符串的 `async def`,然后在 `tools/*.py` 模块底部加一个 `register(...)` 调用。handler 的形参名必须与 JSON schema 的 `properties` 一致。工具返回**JSON 字符串**,而非 dict。

**Skill 渐进式披露**(`agents/fault_perception/prompt_builder.py` + `skills/`):Skill 是按需加载的 markdown 文档。`skills/index.md`(L0 索引)始终嵌入 system prompt;匹配到的故障类型对应的 L1 完整 Skill 正文,只在 WORKFLOW/GUIDED 模式下才加入。Skill 放在 `skills/core/`(诊断类)、`skills/workflows/`(固定流程)、`skills/learned/`(自动生成,可能尚不存在)。`./memory/MEMORY.md` 也会注入 prompt(截断到 2000 字符)。

## 数据契约

一个**用例(case)**是 `storage/cases/case_XXX/` 下的五个文件:
- `data.csv` —— KPI 时序。列:`timestamp,level,ue_id,src,dst,success_rate,message_name,procedure`。`level` ∈ `link|trace|session`;`message_name` 是该 hop 的 3GPP 消息名(link/trace 有值,如 `Nsmf_PDUSession_CreateSMContext Request`,session 为空);`procedure` 是流程 slug(每行都有,如 `pdu_create`)。**`success_rate < 0.995` 是到处都在用的异常阈值**。
- `topo.txt` —— 嵌套拓扑:`DC:` → `ResourcePool:` → `NE_type: NE_id(role)` 行。
- `process.txt` —— 业务流模板 + 每个 UE 解析后的跳(`UE_id: src->dst -> src->dst`)。
- `result.txt` —— 真值 JSON:`{"fault_elements": [...], "fault_links": ["src->dst", ...]}`。
- `metadata.json` —— `CaseMetadata`(故障类型/模式、难度、seed、tags、校验状态)。

**故障分类法**在 `simulator/models.py`:`FaultMode` = `link|business`;`FaultPointType` = `single_ne, multi_ne, all_type_ne, multi_type_ne, resource_pool, dc, path_link, path_trace, path_session, switch, normal`。9 种 NE 类型(AMF/SMF/UPF/PCF/UDM/AUSF/NRF/NSSF/gNB)。`confidence.py::FAULT_SIGNATURES` 里的签名模式和 Skill 都映射到这套分类法 —— 新增故障类型时要保持一致。

## 存储层

`agents/shared/storage.py` 定义了 SQLite schema(6 张表:`cases`、`diagnosis_sessions`、`reasoning_steps`、`evaluations`、`optimization_suggestions`、`loop_iterations`),外加用例目录和会话轨迹的文件系统辅助方法。每次 DB 操作都新开一个 `sqlite3.connect()`(无长连接)。用例文件和轨迹写到 DB 路径的父目录(`storage/`)下。

**有两个数据目录,不是一个:**独立 CLI 入口(如 `agents.fault_perception.agent` 的 `--data-dir ./data`)读的是原始 `data/case_XXX/`,而 `ClosedLoopRunner` 直接用 Agent 1 产出的内存 `CasePackage` 做诊断、并落盘到 `storage/`。不要假设有单一数据源 —— 先确认调用方走的是哪条路径。

## 前端

React 18 + TypeScript + Vite + recharts。三个视图(`DataGenView`、`FaultPerceptionView`、`EvaluationView`)+ Dashboard,由 FastAPI 后端通过 REST + WebSocket(`/ws/updates`,推送实时进度)支撑。CORS 锁定到 localhost 开发端口。API 客户端和类型定义在 `frontend/src/api/`。
