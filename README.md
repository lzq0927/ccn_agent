# ccn-agent — 5GC 故障诊断闭环系统

> 用 LLM Agent 实现 5G 核心网(5GC)的**故障数据生成 → 故障感知诊断 → 评估优化**闭环:仿真器生成带真值的故障遥测(KPI 时序 + 拓扑 + 业务流),Agent 诊断出根因故障,再把诊断准确率反馈到数据生成与诊断策略,持续自优化。

系统由**三个 Agent**构成闭环,设计借鉴 Hermes Agent 模式(Agent Loop、工具自注册、Skill 渐进式披露、Memory),并针对 5GC 故障诊断场景做了裁剪。

---

## 目录

- [核心特性](#核心特性)
- [系统架构](#系统架构)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [常用命令](#常用命令)
- [配置](#配置)
- [数据契约](#数据契约)
- [API 与前端](#api-与前端)
- [Agent 2 核心:置信度路由与 Agent Loop](#agent-2-核心置信度路由与-agent-loop)
- [开发与测试](#开发与测试)
- [更多文档](#更多文档)

---

## 核心特性

- **三 Agent 闭环**:数据生成(设计态)→ 故障感知(运行态)→ 评估优化(设计态),评估结果回流驱动下一轮生成与诊断策略。
- **离散事件仿真器**:从 5GC 拓扑 + 业务流模板出发,生成 link / trace / session 三级 KPI 时序,并注入 link / business 两类故障,产出**带真值标签**的故障用例。
- **基于置信度的路由**(Agent 2 核心):规则式 `ConfidenceAssessor` 从 KPI 提取异常特征,按分数把诊断任务导向 **WORKFLOW / GUIDED / AUTONOMOUS** 三条路径,在确定性与灵活性之间权衡。
- **Hermes 风格 Agent Loop**:标准 `prompt → LLM → 工具调用 → 循环`,工具自注册,Skill 按需渐进披露,带迭代上限与上下文管理。
- **诊断工具集**:覆盖 KPI 异常检测、拓扑解析、业务流追踪、故障候选排序、时序模式分析等(详见 [`docs/architecture.md`](docs/architecture.md))。
- **全栈可视化**:FastAPI 后端(REST + WebSocket 实时进度)+ React/Vite 前端(Dashboard + 三个视图)。
- **OpenAI 兼容 LLM**:统一异步客户端,改 `base_url` 即可对接 OpenAI / OpenRouter / 本地 Ollama 等。

---

## 系统架构

系统由 `agents/closed_loop.py` 中的 `ClosedLoopRunner` 编排三个 Agent,每个 Agent 各自掌管一个环路:

```
+======================================================================+
|               5GC Fault Diagnosis Closed-Loop System                 |
+======================================================================+
|  +-------------------+   +--------------------+   +----------------+ |
|  | Agent 1 数据生成   |   | Agent 2 故障感知   |   | Agent 3 评估   | |
|  | (设计态)          |   | (运行态) ← 核心    |   | (设计态)       | |
|  | SimulatorWrapper  |   | ConfidenceAssessor |   | Evaluator      | |
|  | LLM Validator     |   | WorkflowEngine     |   | TraceAnalyzer  | |
|  | HardCaseGenerator |   | AgentLoop(Hermes)  |   | CaseLibrary    | |
|  |                   |   | SkillSystem        |   | OptAdvisor     | |
|  |                   |   | ToolRegistry       |   |                | |
|  +--------+----------+   +---------+----------+   +-------+--------+ |
|  Loop1: 生成+校验+重试   Loop2: 置信度评估+路由+诊断   Loop3: 评估+沉淀 |
+======================================================================+
         |                            |                    |
   +-------------+              +--------------+    (建议回流 ↓)
   | SQLite+Files|              | React 前端    |   Agent1 新增难例 / Agent2 Skill 更新
   +-------------+              +--------------+
```

- **Loop 1(数据生成)**:仿真器生成用例 → LLM 校验器多维度检查 → 不通过则调参重试(自校验闭环)。
- **Loop 2(故障感知)**:`ConfidenceAssessor` 评估置信度 → 路由到三条路径之一 → 输出带完整推理链的 `DiagnosisResult`。
- **Loop 3(评估优化)**:与真值比对(P/R/F1)→ 分析推理链质量 → 构建案例库 → 产出 `OptimizationSuggestion`,反馈回 Agent 1(新增难例)和 Agent 2(Skill 更新)。

Agent 之间通过异步发布/订阅的 `MessageBus`(`agents/shared/message_bus.py`)通信,通过 `Storage` SQLite 层共享状态。

---

## 项目结构

```
ccn_agent/
├── agents/                    # 三 Agent + 闭环编排
│   ├── closed_loop.py         # ClosedLoopRunner:生成→诊断→评估 主入口
│   ├── data_generation/       # Agent 1:故障数据生成(设计态)
│   │   ├── agent.py           #   主编排 + 自校验闭环
│   │   ├── simulator_wrapper.py  # 封装 simulator
│   │   ├── validator.py       #   LLM 多维度校验
│   │   └── hard_case_generator.py
│   ├── fault_perception/      # Agent 2:故障感知/诊断(运行态,系统核心)
│   │   ├── agent.py           #   Hermes 风格 Agent Loop
│   │   ├── confidence.py      #   置信度评估 + FAULT_SIGNATURES
│   │   ├── router.py          #   路由决策
│   │   ├── workflow_engine.py #   WORKFLOW 确定性流程
│   │   ├── parallel_explorer.py  # AUTONOMOUS 并行探索
│   │   ├── prompt_builder.py  #   Skill 渐进式加载
│   │   └── context_manager.py
│   ├── evaluation/            # Agent 3:评估优化(设计态)
│   │   ├── agent.py
│   │   ├── evaluator.py       #   真值对比 P/R/F1
│   │   ├── trace_analyzer.py  #   推理链质量分析
│   │   ├── case_library.py
│   │   └── optimization_advisor.py
│   └── shared/                # 共享基础设施
│       ├── llm_client.py      #   OpenAI 兼容异步客户端
│       ├── llm_config.py      #   YAML LLM 配置加载器
│       ├── models.py          #   跨 Agent 数据模型
│       ├── storage.py         #   SQLite 存储层(6 张表)
│       └── message_bus.py     #   异步 pub/sub 消息总线
├── simulator/                 # 离散事件仿真器:生成 5GC 遥测与故障
├── tools/                     # 诊断工具集(import 时自注册)
├── skills/                    # Skill 渐进式披露文档
│   ├── core/                  #   核心诊断 Skill(single_ne/multi_ne/...)
│   ├── workflows/             #   固定工作流 Skill
│   └── exploration/           #   自主探索模式 Skill
├── api/                       # FastAPI 后端(REST + WebSocket)
├── frontend/                  # React 18 + TypeScript + Vite 前端
├── config/                    # 系统与 LLM 配置
├── docs/                      # 架构与开发指南
├── tests/                     # pytest 测试
├── storage/                   # 运行时状态:SQLite + 用例文件(gitignore)
├── data/                      # 仿真原始输出(gitignore)
├── 顶层设计/                  # Agent 团队协作流程指引(非运行时架构)
└── pyproject.toml
```

> ⚠️ `顶层设计/` 文件夹记录的是「一支 Claude Code Agent 团队如何协作开发本项目」(角色矩阵、协作协议、任务流程),**不是**系统运行时架构,请当作开发流程指引阅读。

---

## 快速开始

### 环境要求

- **Python ≥ 3.11**(pyproject 要求;开发目标 py311)
- **Node.js**(前端构建,Vite 5)
- 一个 **OpenAI 兼容**的 LLM 服务(API key)

### 1. 安装

```bash
# 可编辑安装,带开发工具(pytest / ruff)
pip install -e ".[dev]"
```

### 2. 配置 LLM

`config/llm.yaml` 内置了三种 provider 模板(OpenAI / OpenRouter / 本地 Ollama)。复制为本地配置并填入 key:

```bash
cp config/llm.yaml config/llm.local.yaml   # llm.local.yaml 已 gitignore
```

在 `config/llm.local.yaml` 中选择 provider 并填写 API key;也可直接用环境变量(各 provider 的 `api_key_env`,默认 `OPENAI_API_KEY`)。

> 详见 [`config/llm.yaml`](config/llm.yaml) 与 [`config/default.yaml`](config/default.yaml)。所有 LLM 调用统一走 `agents/shared/llm_client.py`,无需改动业务代码即可切换 provider。

### 3. 跑完整闭环

```bash
python -m agents.closed_loop --cases 10 --iterations 1 --seed 42
```

这一条命令会依次执行:Agent 1 生成 10 个用例 → Agent 2 逐个诊断 → Agent 3 评估并产出优化建议。状态写入 `./storage/`。

---

## 常用命令

```bash
# —— 单独运行各 Agent ——
python -m agents.data_generation.agent --count 10 --seed 42      # Agent 1:生成用例
python -m agents.fault_perception.agent --case-id 1 --data-dir ./data   # Agent 2:诊断单个用例
python -m agents.evaluation.agent --evaluate-all                # Agent 3:评估全部诊断结果

# —— 完整闭环(主入口)——
python -m agents.closed_loop --cases 10 --iterations 1 --seed 42

# —— 仅仿真管线(写原始 data/ 目录,不入库)——
python -m simulator.main

# —— API 服务(FastAPI,端口 8000)——
python -m uvicorn api.app:app --reload --port 8000

# —— 管理后台前端(端口 5173,首次需 npm install)——
cd frontend && npm install && npm run dev

# —— 展会演示前端 · 高稳智能体数字孪生指挥中心(端口 5174)——
cd frontend-show && npm install && npm run dev
#   DEMO 模式(默认):内置真实样本数据,自动循环播放完整闭环故事,无需后端/LLM。
#   LIVE 模式(可选):另起后端 `python -m uvicorn api.app:app --port 8000`,
#                    再到前端顶栏点 DEMO → LIVE,即可用真实用例文件驱动孪生。
```

> 💡 用 `python -m uvicorn ...` 而非裸 `uvicorn` 更稳妥——`pip install` 后 `uvicorn.exe` 所在的 `Scripts/` 目录未必在 `PATH` 中,直接敲 `uvicorn` 可能「无法识别命令」。

---

## 配置

### `config/default.yaml` — 系统配置

存储路径、各 Agent 参数、阈值、API/CORS 等。关键字段:

| 字段 | 含义 |
|------|------|
| `system.storage_path` / `data_path` | 运行时状态与仿真输出目录 |
| `agents.data_generation.*` | 校验重试次数、默认生成数、难例比例、校验模型 |
| `agents.fault_perception.*` | Agent Loop 迭代上限、Skill/Memory 目录 |
| `agents.evaluation.*` | 准确率阈值、案例库路径 |
| `api.*` | 监听地址、端口、CORS 白名单 |

### `config/llm.yaml` — LLM provider/模型

定义可用的 provider(OpenAI / OpenRouter / 本地)。**复制为 `config/llm.local.yaml`**(已 gitignore)并在其中填 key、选默认 provider。

> ⚠️ **置信度阈值是硬编码的**:`agents/fault_perception/confidence.py` 中的 `THRESHOLD_HIGH`(0.7)/ `THRESHOLD_LOW`(0.3)是模块常量,**并不**从 `config/default.yaml` 的 `confidence_threshold_high/low` 读取——配置字段存在但未接通。要调路由阈值,请改这两个常量。

---

## 数据契约

一个**用例(case)**是 `storage/cases/case_XXX/` 下的五个文件:

| 文件 | 内容 |
|------|------|
| `data.csv` | KPI 时序(见下) |
| `topo.txt` | 嵌套拓扑:`DC:` → `ResourcePool:` → `NE_type: NE_id(role)` |
| `process.txt` | 业务流模板 + 每个 UE 解析后的跳(`UE_id: src->dst -> src->dst`) |
| `result.txt` | 真值 JSON:`{"fault_elements": [...], "fault_links": ["src->dst", ...]}` |
| `metadata.json` | `CaseMetadata`(故障类型/模式、难度、seed、tags、校验状态) |

### `data.csv` 列

```
timestamp, level, ue_id, src, dst, success_rate, message_name, procedure
```

- `level` ∈ `link | trace | session`
- `message_name`:该跳的 3GPP 消息名(link/trace 有值,如 `Nsmf_PDUSession_CreateSMContext Request`;session 为空)
- `procedure`:流程 slug(每行都有,如 `pdu_create`)
- **`success_rate < 0.995`** 是全系统通用的异常阈值

### 故障分类法(见 `simulator/models.py`)

- **`FaultMode`**:`link | business`
- **`FaultPointType`**:`single_ne, multi_ne, all_type_ne, multi_type_ne, resource_pool, dc, path_link, path_trace, path_session, switch, normal`
- **9 种 NE 类型**:AMF / SMF / UPF / PCF / UDM / AUSF / NRF / NSSF / gNB
- `confidence.py::FAULT_SIGNATURES` 中的签名与 Skill 都映射到这套分类法——新增故障类型时需保持一致。

---

## API 与前端

### 后端端点(FastAPI,前缀 `/api/v1`)

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/dashboard/summary` | 三环总览指标 |
| GET | `/health` | 健康检查 |
| POST | `/generation/batch` | 批量生成用例(异步) |
| GET | `/generation/batch/{id}` | 查询批次状态 |
| GET | `/generation/cases` | 用例列表(分页/筛选) |
| GET | `/generation/cases/{id}` | 用例详情 |
| POST | `/perception/diagnose` | 提交诊断(`{case_id}`) |
| GET | `/perception/session/{id}` | 诊断会话 + 推理步骤 |
| GET | `/perception/history` | 诊断历史 |
| GET | `/perception/status` | 感知服务状态 |
| GET | `/evaluation/suggestions` | 优化建议列表 |
| PUT | `/evaluation/suggestions/{id}?action=apply` | 应用建议 |
| GET | `/evaluation/loop-progress` | 闭环进度 |
| GET | `/evaluation/case-library` | 案例库 |
| WS | `/ws/updates` | 实时进度推送 |

启动:`python -m uvicorn api.app:app --reload --port 8000`,交互文档在 http://localhost:8000/docs。

### 管理后台前端 `frontend/`(React 18 + TypeScript + Vite + recharts)

- **Dashboard**:三环进度、关键指标、实时事件流
- **DataGenView**:用例生成与浏览
- **FaultPerceptionView**:诊断过程与推理链
- **EvaluationView**:评估指标与优化建议

启动:`cd frontend && npm install && npm run dev`,打开 http://localhost:5173。Vite 把 `/api`、`/ws` 代理到后端 8000;CORS 已锁定到本地开发端口。

### 展会演示前端 `frontend-show/`(高稳智能体 · 5GC 数字孪生指挥中心)

独立的沉浸式指挥中心,面向通讯展会大屏,全新设计、不参考 `frontend/`。三栏布局:中央**数字孪生**(网络本体)+ 左侧**大脑架构**(三 Agent 闭环)+ 右侧**阶段详情**,底部 8 阶段时间轴,自动循环播放「数据生成→异常检测→置信度评估→根因推理→执行恢复→网络恢复→评估优化」完整故事。技术栈 React 18 + TS + Vite + Framer Motion,数字孪生为手写 SVG。

```bash
cd frontend-show && npm install && npm run dev    # → http://localhost:5174
```

- **DEMO 模式(默认)**:内置取自真实 `storage/cases` 的样本数据,确定性自动循环,**不依赖后端/LLM**,展会现场 100% 可靠。顶栏可切场景(A 全域 gNB / B AMF 单点 / C 用户面链路)、播放暂停、变速、拖拽时间轴。
- **LIVE 模式(可选)**:顶栏点 `DEMO` → `LIVE`,用真实用例的 `topo/data.csv/result` 驱动孪生与 KPI(需后端 `python -m uvicorn api.app:app --port 8000`)。置信度为实时估算、评估假定命中,真实诊断需运行 Agent 2/3 闭环。

详见 [`frontend-show/README.md`](frontend-show/README.md)。

---

## Agent 2 核心:置信度路由与 Agent Loop

Agent 2 是系统核心,理解四件事即可上手二次开发:

**① 基于置信度的路由**(`agents/fault_perception/confidence.py`)

规则式 `ConfidenceAssessor` 从 KPI 提取特征(异常严重度、空间/时间清晰度、NE 主导度),与已知故障签名比对,算出 0–1 分数:

- `> 0.7` → **WORKFLOW**:`WorkflowEngine` 执行确定性固定步骤,直接调工具,不走 LLM Loop。
- `0.3–0.7` → **GUIDED**:Agent Loop,并在 prompt 注入匹配度最高的 Skill 文档。
- `≤ 0.3` → **AUTONOMOUS**:完整 Agent Loop + 并行探索。

**② Agent Loop**(`FaultPerceptionAgent._run_agent_loop`)

标准 `prompt → LLM → 工具调用 → 循环`,带迭代上限。Loop 仅在 LLM 调用 `submit_diagnosis` 时终止——`submit_diagnosis` 是在 `agent.py` 里注入的**伪工具**,不在工具注册表中。

**③ 工具自注册**(`tools/registry.py`)

每个工具模块在 import 时调用 `register(name=..., description=..., parameters={JSON schema}, handler=<async fn>)`。`FaultPerceptionAgent.__init__` 调用 `import_all_tools()` 触发注册,并按同名函数绑定 handler。handler 形参名须与 schema `properties` 一致;工具返回 **JSON 字符串**(非 dict)。

> 新增工具:定义一个返回 JSON 字符串的 `async def`,在 `tools/*.py` 底部加一个 `register(...)` 调用即可。

**④ Skill 渐进式披露**(`prompt_builder.py` + `skills/`)

Skill 是按需加载的 markdown 文档。`skills/index.md`(L0 索引)始终嵌入 system prompt;匹配到的故障类型对应的完整 Skill 正文,只在 WORKFLOW/GUIDED 模式下注入。Skill 分 `core/`(诊断类)、`workflows/`(固定流程)、`exploration/`(自主探索)。`./memory/MEMORY.md` 也会注入 prompt(截断到 2000 字符)。

---

## 开发与测试

```bash
# 代码检查(line-length 100,target py311)
ruff check .

# 跑测试(pytest,asyncio_mode=auto)
pytest                       # 全部
pytest tests/test_chr_pipeline.py     # 单文件
pytest tests/test_chr_pipeline.py::test_name   # 单用例
```

存储层有两个数据目录,不要混淆:**独立 CLI 入口**(如 `agents.fault_perception.agent --data-dir ./data`)读原始 `data/case_XXX/`;而 `ClosedLoopRunner` 直接用 Agent 1 产出的内存 `CasePackage` 做诊断并落盘到 `storage/`。两者均 gitignore,由仿真器重新生成。

`agents/shared/storage.py` 定义 6 张表(`cases`、`diagnosis_sessions`、`reasoning_steps`、`evaluations`、`optimization_suggestions`、`loop_iterations`),每次 DB 操作新开 `sqlite3.connect()`(无长连接)。

---

## 更多文档

- [`docs/architecture.md`](docs/architecture.md) — 完整模块清单、工具表、数据库表、架构图
- [`docs/agent_guide.md`](docs/agent_guide.md) — Agent 开发指南与数据格式
- [`CLAUDE.md`](CLAUDE.md) — 给 Claude Code 的操作要点与踩坑提示
