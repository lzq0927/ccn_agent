# 云核心网故障智能运维系统 — 系统规格说明书

## 1. 系统愿景与目标

构建一个**故障数据生成 → 故障感知 → 评估优化**的三闭环智能运维系统。

- **故障数据生成**（离线/设计态）：基于核心网仿真器生成故障场景数据，支持自我校验与难例增强，持续为故障感知Agent提供高质量训练语料。
- **故障感知Agent**（在线/运行态）：接收实时KPI时序流，对故障进行根因定位。确定性/简单故障走Skill/工作流（确定输出），困难/未知故障引入Agent+LLM自主探索，最终输出置信度评级结果。
- **评估优化Agent**（离线/设计态）：验证故障感知Agent输出的准确性，分析中间推理过程，沉淀案例库，生成优化建议反哺故障感知Agent。

前端Dashboard贯穿三模块，支持查看各模块工作状态、迭代过程与关键中间结果。

---

## 2. 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (Web Dashboard)                  │
│   /iteration-history  /perception-live  /case-library  /reports  │
└─────────────────────────────────────────────────────────────────┘
           ▲                  ▲                  ▲
           │                  │                  │
    ┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐
    │IterationState│    │PerceptionAgent│    │  Evaluator  │
    │  Manager     │    │  (Online)     │    │   Agent    │
    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘
           │                  │                  │
    ┌──────┴──────┐    ┌──────┴──────┐    ┌──────┴──────┐
    │ CaseLibrary │    │  Skills     │    │  Skills     │
    └─────────────┘    │  + Tools    │    │  + Tools    │
                       └─────────────┘    └─────────────┘
                              ▲
                       ┌──────┴──────┐
                       │Simulator(Existing)│
                       │fault_data_gen Agent│
                       └─────────────┘
```

### 2.1 三大迭代闭环

**闭环1 — 设计态：故障数据生成自演化**
```
故障数据生成Agent
  ├── 生成原始用例 → LLM自我校验 → 通过? ──否──→ 修正 → 再校验
  ├── 不通过 → 记录失败原因 → 沉淀到失败案例库
  └── 通过 → 写入CaseLibrary → 供评估/感知使用
  └── 难例增强：基于失败案例生成更难样本
```

**闭环2 — 运行态：故障感知双模式**
```
感知输入(KPI时序+拓扑+流程)
  │
  ▼
置信度评估模块
  │
  ├── 置信度≥阈值 ──→ Skill/工作流 ──→ 确定性故障结论
  │
  └── 置信度<阈值 ──→ Agent+LLM自主探索
                        ├── 策略A：单Agent深度分析
                        ├── 策略B：多Agent并行探索→投票融合
                        └── 策略C：先规则后LLM混合
  │
  ▼
根因输出 + 置信度评级
  │
  ▼
记录推理过程 → 送评估
```

**闭环3 — 设计态：评估优化反馈**
```
感知结果 + 推理过程 → 评估Agent
  │
  ├── 准确性验证：预测 vs 真实
  ├── 中间过程分析：关键节点日志 + LLM思考链
  ├── 成功/失败案例归档 → CaseLibrary
  └── 优化建议生成 → 感知Agent Skills/Prompts更新
```

---

## 3. 核心数据模型

### 3.1 故障案例（Case）
```python
@dataclass
class FaultCase:
    case_id: str                    # 全局唯一ID，格式: C{iter:04d}_{seq:04d}
    iteration: int                  # 所属迭代编号
    source: str                     # "simulator" | "perception_failure" | "manual"

    # 故障配置（Ground Truth）
    fault_config: FaultConfig       # from simulator/models.py

    # 感知输入
    input_kpi_path: str            # data.csv路径
    input_topo_path: str           # topo.txt路径
    input_process_path: str         # process.txt路径

    # 感知输出
    perceived_fault_elements: List[str]   # 感知为故障的网元
    perceived_fault_links: List[str]      # 感知为故障的链路
    perception_confidence: float          # 0.0~1.0
    perception_mode: str                  # "skill" | "llm_explorer"
    perception_reasoning: List[str]       # 推理步骤摘要（供评估分析）

    # 评估结果
    accuracy: float                 # 准确率
    is_correct: bool               # 是否完全正确
    eval_feedback: str             # 评估反馈文本
    optimization_suggestions: List[str]  # 优化建议
    lessons_learned: str           # 经验总结

    # 元数据
    created_at: datetime
    perception_latency_ms: float
    tags: List[str]               # ["multi_ne", "ambiguous", "normal", ...]
```

### 3.2 迭代状态（IterationState）
```python
@dataclass
class IterationState:
    iteration: int

    # 三大Agent状态
    data_gen_status: str           # "idle" | "running" | "done" | "error"
    perception_status: str         # "idle" | "running" | "done" | "error"
    eval_status: str              # "idle" | "running" | "done" | "error"

    # 迭代指标
    data_gen_cases_generated: int
    data_gen_cases_passed: int
    perception_accuracy: float    # 本迭代感知准确率
    perception_avg_confidence: float

    # 优化动作
    skills_updated: List[str]      # 本次更新的Skill列表
    prompts_updated: List[str]     # 本次更新的Prompt列表
    new_cases_from_failures: int   # 从失败中生成的难例数

    # 时间戳
    started_at: datetime
    completed_at: Optional[datetime]
```

### 3.3 LLM探索结果（ExplorerResult）
```python
@dataclass
class ExplorerResult:
    explorer_id: str
    strategy: str                  # "single_deep" | "multi_parallel" | "hybrid"
    hypotheses: List[str]          # 假设列表
    evidence: List[str]            # 支撑证据
    confidence: float
    reasoning_trace: List[str]     # 思考过程
    concluded_fault_elements: List[str]
    concluded_fault_links: List[str]
    duration_ms: float
    error: Optional[str]
```

---

## 4. 故障感知Agent详解

### 4.1 置信度评估（Confidence Evaluator）

**输入**：KPI时序数据、拓扑、业务流程
**输出**：`confidence_score` (0.0~1.0) + `difficulty_hints` []

**评分维度**：

| 维度 | 权重 | 说明 |
|------|------|------|
| 故障信号强度 | 30% | 正常区间 vs 故障区间KPI差距 |
| 故障点唯一性 | 25% | 是否能唯一映射到故障点 |
| 告警数量/类型 | 20% | 同一时段告警是否集中 |
| 拓扑复杂度 | 15% | 网元数量、路径跳数 |
| 历史相似案例 | 10% | CaseLibrary中是否有高度相似案例 |

**阈值规则**：
- `confidence ≥ 0.85` → **高置信度** → Skill/工作流处理
- `0.5 ≤ confidence < 0.85` → **中置信度** → LLM单Agent探索
- `confidence < 0.5` → **低置信度** → 多Agent并行探索+投票融合

### 4.2 技能（Skills）

#### skill_fault_inference（确定性故障推理）
触发条件：高置信度场景
功能：基于规则的故障传播分析
输入：KPI异常点 → 故障类型 → 候选根因
流程：
1. 识别KPI骤降时间点
2. 逐层向上追溯：session降 → trace降 → link降
3. 定位最低层异常链路/网元
4. 结合拓扑判断影响范围
5. 输出故障元素列表

#### skill_llm_explorer（LLM自主探索）
触发条件：中/低置信度场景
功能：多策略LLM分析
- 策略A（单Agent深度分析）：给LLM完整上下文，要求逐步推理
- 策略B（多Agent并行）：同时启动3个不同Prompt策略的LLM分析，最后投票
- 策略C（混合）：先规则快速缩小范围，再LLM深度分析剩余候选

#### skill_self_optimization（自优化）
功能：分析近期感知失败案例，更新内部Prompt/Skill
触发：每N个案例或每次评估完成后自动运行
流程：
1. 收集近M个失败/低置信度案例
2. 让LLM分析共性模式
3. 生成优化建议（调整Prompt措辞、补充规则、调整阈值）
4. 生成新版本Skill/Prompt文件
5. 记录变更历史

### 4.3 工作流（PerceptionWorkflow）

```
perceive_fault(input_kpi, input_topo, input_process)
  │
  ▼
extract_anomalies() → List[Anomaly]
  │
  ▼
evaluate_confidence(anomalies, topo, process)
  │
  ├─≥ 0.85──→ run_skill_fault_inference()
  │                     │
  │                     ▼
  │              validate_result()
  │                     │
  │                     ▼
  │              return SkillResult
  │
  └─< 0.85──→ run_llm_explorer(mode=auto)
                      │
                      ▼
               multi_strategy_fallback()
                      │
                      ▼
               return ExplorerResult
  │
  ▼
package_and_record()
  │
  ▼
return PerceptionOutput
```

---

## 5. 评估优化Agent详解

### 5.1 准确性验证（Accuracy Validator）
- **精确率**：预测故障元素/链路中，真正故障的比例
- **召回率**：真正故障被感知Agent找到的比例
- **F1分数**：综合评价
- **特殊情况计分**：正常样本被误判为故障、未知类型故障识别

### 5.2 过程分析（Process Analyzer）
分析内容：
- 推理链是否完整、是否有逻辑跳跃
- 是否有效利用了拓扑结构信息
- 多Agent探索时各Agent结论是否一致
- 关键决策点是否有依据

### 5.3 优化建议生成（Optimization Suggester）
生成内容：
- Skill调整建议：补充新规则、调整阈值、修正逻辑
- Prompt优化：更清晰的指令、few-shot示例
- 数据增强建议：从失败案例中提取特征，生成更多相似难例
- 知识库补充：新增故障模式到已知模式库

### 5.4 案例库管理（Case Library Manager）
- **分类维度**：故障类型（单网元/多网元/链路/路径）、感知模式（skill/llm）、准确率、置信度
- **难例标注**：对困难样本打标签（"传播链复杂"、"症状模糊"、"多点故障"）
- **检索接口**：支持按故障类型、感知模式、时间范围查询

---

## 6. 故障数据生成Agent详解

### 6.1 自我校验（Self Verifier）
在用例生成后立即调用LLM验证：
- 故障是否在指定时间点激活
- 故障注入是否符合预期（网元/链路/路径）
- KPI数据是否有明显异常
- 正常样本是否确实无故障

### 6.2 难例生成（Hard Case Generator）
策略：
- **多点故障**：同时注入2~3个独立故障点
- **传播链模拟**：故障A引发故障B的症状，使根因不直观
- **噪声注入**：在故障数据中混入少量正常波动
- **边界条件**：故障持续时间极短（3秒）、丢包率极低（1%）

### 6.3 与评估的联动
评估完成后，从失败案例中提取特征，指导生成新的难例：
```
失败案例特征 → 数据生成Agent → 新难例 → 自我校验 → CaseLibrary
```

---

## 7. 前端 Dashboard

### 7.1 页面结构

| 路径 | 内容 |
|------|------|
| `/` | 系统总览：3个Agent状态、当前迭代进度、关键指标 |
| `/iteration/:id` | 单次迭代详情：各Agent输入输出、中间结果 |
| `/perception` | 感知实时监控：当前输入数据、推理过程、输出结果 |
| `/perception/history` | 历史感知记录：案例列表、可疑点标注 |
| `/case-library` | 案例库：分类浏览、高级检索、导出 |
| `/reports` | 报告：准确率趋势、优化建议、Skill变更记录 |

### 7.2 核心组件

- **AgentStatusPanel**：显示各Agent当前状态（idle/running/done/error）+ 关键指标
- **IterationTimeline**：时间线展示迭代过程，可点击展开各阶段详情
- **KPIGraph**：KPI时序数据可视化，支持标注异常区间
- **ReasoningTraceView**：展示感知Agent的推理步骤（树形/链式）
- **CaseCard**：案例卡片，展示基本信息+准确率+标签
- **ConfidenceGauge**：置信度仪表盘
- **SkillDiffViewer**：Skill版本对比（优化前后）
- **CaseLibraryBrowser**：案例库检索和浏览界面

### 7.3 数据接口（REST API）

```
GET  /api/iterations               # 迭代列表
GET  /api/iterations/:id           # 迭代详情
GET  /api/cases?iteration=&type=   # 案例列表
GET  /api/cases/:id                # 案例详情
GET  /api/cases/:id/reasoning     # 推理过程详情
POST /api/cases                    # 手动添加案例
GET  /api/skills/diffs             # Skill变更历史
GET  /api/perception/current       # 当前感知状态
POST /api/perception/input         # 手动输入感知数据
GET  /api/evaluator/suggestions    # 当前优化建议
GET  /api/dashboard/summary        # Dashboard摘要数据
```

---

## 8. 目录结构

```
project_ccn_agent_hermes/
├── SPEC.md                        # 本文件
├── simulator/                     # 已有核心网仿真器（原有代码）
│   ├── models.py
│   ├── topology.py
│   ├── process.py
│   ├── scenario.py
│   ├── engine.py
│   ├── exporter.py
│   └── main.py
├── agents/                         # 3个Agent实现
│   ├── fault_perception/          # 故障感知Agent（在线）
│   │   ├── __init__.py
│   │   ├── agent.py              # Hermes AIAgent子类
│   │   ├── confidence.py         # 置信度评估
│   │   ├── workflow.py           # 感知工作流编排
│   │   ├── skills/
│   │   │   ├── skill_fault_inference.py
│   │   │   ├── skill_llm_explorer.py
│   │   │   └── skill_self_optimization.py
│   │   └── prompts/
│   │       ├── perception_system.txt
│   │       ├── explorer_prompt_a.txt
│   │       ├── explorer_prompt_b.txt
│   │       └── explorer_prompt_c.txt
│   ├── fault_data_gen/            # 故障数据生成Agent（离线）
│   │   ├── __init__.py
│   │   ├── agent.py
│   │   ├── hard_case_generator.py
│   │   ├── verifier.py            # LLM自我校验
│   │   └── skills/
│   │       └── skill_self_verification.py
│   └── evaluator/                  # 评估优化Agent（离线）
│       ├── __init__.py
│       ├── agent.py
│       ├── accuracy.py             # 准确性验证
│       ├── process_analyzer.py     # 过程分析
│       ├── optimizer.py            # 优化建议生成
│       └── skills/
│           ├── skill_case_analysis.py
│           └── skill_optimization_suggestion.py
├── iteration_state/               # 迭代状态管理
│   ├── __init__.py
│   ├── manager.py                 # IterationStateManager
│   └── storage.py                 # JSON文件持久化
├── case_library/                  # 案例库
│   ├── __init__.py
│   ├── manager.py
│   ├── indexer.py                 # 案例索引/检索
│   └── storage.py
├── runner/                        # 主编排器
│   ├── __init__.py
│   ├── orchestrator.py           # 三闭环主流程编排
│   └── api_server.py             # REST API服务（供前端）
├── frontend/                      # 前端Web应用
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── components/            # 共享组件
│       ├── pages/                 # 页面组件
│       ├── hooks/                 # React hooks
│       └── utils/                 # 工具函数
├── logs/                          # 日志目录
├── requirements.txt
└── README.md
```

---

## 9. 技术选型

| 组件 | 技术 |
|------|------|
| Agent框架 | Hermes Agent (Nous Research) |
| LLM | MiniMax M2.7 (当前provider)，支持切换 |
| 前端框架 | React + Vite |
| 状态存储 | JSON文件（iteration_state/、case_library/） |
| API服务 | Python FastAPI |
| 日志 | Python logging → logs/ |
| 仿真器 | 已有simulator/包 |

---

## 10. 运行模式

### 10.1 开发态流程（设计态迭代）
```bash
python runner/orchestrator.py --mode=design --iterations=5
```
流程：故障数据生成 → 感知Agent测试 → 评估 → 生成难例 → 循环

### 10.2 在线感知模式（运行态）
```bash
python runner/api_server.py
# 然后通过REST API或WebSocket推送KPI数据进行感知
```

### 10.3 单案例测试
```bash
python runner/orchestrator.py --mode=single --case-id=001
```

---

## 11. 接口定义（Agent间通信）

### 11.1 数据生成 → 感知
```
生成用例 → CaseLibrary.write_case()
          → 记录 data_gen_cases_generated
```

### 11.2 感知 → 评估
```
感知完成 → PerceptionOutput序列化
          → 写入iteration_state/perception_outputs/
          → 触发评估Agent
```

### 11.3 评估 → 数据生成 + 感知
```
评估完成 → 更新CaseLibrary的accuracy/eval_feedback
          → 如有优化建议 → 写入skills/pending_updates/
          → 感知Agent reload skills
          → 数据生成Agent读取失败案例 → 生成难例
```
