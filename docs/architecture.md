# 5GC 故障诊断闭环系统 - 完整文档

## 项目概述

本系统实现云核心网(5GC)的**故障数据生成→故障感知→评估优化**闭环，由三个Agent协作完成。系统设计借鉴了 Hermes Agent 的核心架构（Agent Loop、Tool自注册、Skill渐进式披露、Memory系统），并针对5GC故障诊断场景做了裁剪。

## 系统架构

```
+====================================================================+
|               5GC Fault Diagnosis Closed-Loop System                |
+====================================================================+
|  +-------------------+   +--------------------+   +----------------+ |
|  | Agent 1: 数据生成  |   | Agent 2: 故障感知  |   | Agent 3: 评估  | |
|  | (离线/设计态)      |   | (在线/运行态)      |   | (离线/设计态)  | |
|  | SimulatorWrapper  |   | ConfidenceAssessor |   | Evaluator      | |
|  | LLM Validator     |   | WorkflowEngine     |   | TraceAnalyzer  | |
|  | HardCaseGenerator |   | AgentLoop(Hermes)  |   | CaseLibrary    | |
|  | free5gc(未来)     |   | SkillSystem        |   | OptAdvisor     | |
|  |                   |   | ToolRegistry(14)   |   |                | |
|  |                   |   | MemorySystem       |   |                | |
|  +--------+----------+   +---------+----------+   +-------+--------+ |
|  Loop1: 生成+校验+优化   Loop2: 感知+路由+诊断   Loop3: 评估+沉淀  |
+====================================================================+
         |                            |
   +-------------+              +--------------+
   | SQLite+Files|              | React前端     |
   +-------------+              +--------------+
```

## 三环闭环

### Loop 1: 数据生成闭环（设计态）
SimulatorWrapper生成 → LLM Validator校验 → 通过入库/失败调整重试

### Loop 2: 故障感知闭环（运行态）
ConfidenceAssessor评估 → 路由(>0.7工作流 / 0.3~0.7引导 / <0.3自主) → 输出DiagnosisResult

### Loop 3: 评估优化闭环（设计态）
Evaluator对比真值 → TraceAnalyzer分析推理 → CaseLibrary沉淀 → OptAdvisor建议反馈

## 模块清单

### 共享基础设施 (agents/shared/)
| 文件 | 功能 |
|------|------|
| models.py | 20+ 数据模型 (CaseData, DiagnosisResult, EvaluationReport等) |
| llm_client.py | OpenAI兼容LLM客户端 (重试/回退/流式) |
| storage.py | SQLite存储层 (6张表, CRUD, 文件操作) |
| message_bus.py | 异步pub/sub消息总线 |

### Agent 1: 数据生成 (agents/data_generation/)
| 文件 | 功能 |
|------|------|
| agent.py | 主编排, 自校验闭环 |
| simulator_wrapper.py | 封装已有simulator |
| validator.py | LLM数据校验 (5维度) |
| hard_case_generator.py | 难例生成 (5类) |
| free5gc_adapter.py | 未来free5gc对接占位 |

### Agent 2: 故障感知 (agents/fault_perception/)
| 文件 | 功能 |
|------|------|
| agent.py | Hermes风格Agent Loop |
| confidence.py | 置信度评估 (6维特征, 三级路由) |
| router.py | 路由决策 |
| workflow_engine.py | 固定工作流执行 |
| parallel_explorer.py | 多路并行探索 |
| prompt_builder.py | 渐进式Skill加载 |
| context_manager.py | 上下文窗口管理 |

### 诊断工具 (tools/) - 14个
| 工具 | 功能 |
|------|------|
| analyze_kpi_anomalies | KPI异常检测 |
| find_common_ne | 故障网元定位 |
| get_kpi_summary | KPI统计摘要 |
| parse_topology | 拓扑解析 |
| check_ne_membership | NE归属分析 |
| get_topology_connections | 拓扑连接推导 |
| parse_ue_flows | UE流解析 |
| trace_ue_impact | UE影响追踪 |
| find_ue_ne_mapping | UE-NE映射 |
| isolate_fault_candidates | 故障候选排序 |
| check_temporal_pattern | 时间模式检测 |
| compare_diagnoses | 诊断对比 |
| compute_success_rate_stats | 成功率统计 |
| detect_anomaly_sudden_change | 突变检测 |

### Agent 3: 评估优化 (agents/evaluation/)
| 文件 | 功能 |
|------|------|
| agent.py | 主编排 |
| evaluator.py | 真值对比 (P/R/F1) |
| trace_analyzer.py | 推理质量分析 |
| case_library.py | 案例库构建 |
| optimization_advisor.py | 优化建议生成 |

### Skill系统 (skills/) - 10个Skill
- 7个核心诊断Skill (single_ne, multi_ne, resource_pool, dc, path, switch, normal)
- 3个工作流Skill (link_fault, business_fault, cascading)

### API (api/)
| 端点 | 功能 |
|------|------|
| POST /api/v1/generation/batch | 批量生成 |
| GET /api/v1/generation/cases | 用例列表 |
| POST /api/v1/perception/diagnose | 提交诊断 |
| GET /api/v1/perception/session/{id} | 诊断过程 |
| GET /api/v1/evaluation/suggestions | 优化建议 |
| GET /api/v1/dashboard/summary | 总览 |
| WS /ws/updates | 实时推送 |

### 前端 (frontend/)
- Dashboard: 三环进度, 关键指标, 实时事件
- DataGenView: 用例生成/浏览
- FaultPerceptionView: 诊断过程/推理链
- EvaluationView: 评估指标/优化建议

## 数据库表
| 表 | 用途 |
|----|------|
| cases | 用例管理 |
| diagnosis_sessions | 诊断会话 |
| reasoning_steps | 推理步骤 |
| evaluations | 评估结果 |
| optimization_suggestions | 优化建议 |
| loop_iterations | 闭环迭代 |

## 运行方式

```bash
# 安装依赖
pip install -e ".[dev]"

# Agent 1: 生成数据
python -m agents.data_generation.agent --count 10

# 闭环运行
python -m agents.closed_loop --cases 10 --iterations 1

# 启动API
uvicorn api.app:app --reload --port 8000

# 前端
cd frontend && npm install && npm run dev
```
