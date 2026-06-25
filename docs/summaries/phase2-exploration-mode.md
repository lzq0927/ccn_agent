# Phase 2 完成总结 — 故障感知探索模式(多算法框架)

> **日期**:2026-06-25 | **状态**:✅ 已完成并验收 | **对应计划**:`docs/plans/free5gc-chr-and-exploration-mode.md`(Phase 2 部分)
> **前置**:Phase 1(`docs/summaries/phase1-free5gc-chr-pipeline.md`)—— 探索模式消费其 CHR 数据。

## 概述

Phase 2 在真实 CHR 之上构建了**探索模式**(Agent + LLM + 多算法框架)。当 KPI 模糊(微损/隐患)但用户级 CHR 显示失败聚集时,路由到 `Route.EXPLORATION`,由统计 + ML + 贝叶斯多算法做参数扫描与多视图消融,综合出单一诊断。**无 LLM 时也完全可用**(确定性后验兜底)。

**验收结果**:64 个测试全绿(37 Phase 1 + 27 Phase 2),全仓库 `ruff check .` 清洁,新文件 `ruff format` 清洁。实跑微损用例 → 正确诊断、消融稳健。

---

## 建了什么(M2.1–M2.9 全绿)

### 路由与触发(M2.1)
| 文件 | 改动 |
|---|---|
| `agents/shared/models.py` | `Route` 加 `EXPLORATION` 枚举;加 `ParamGrid`/`SweepCell`/`FindingsReport` 数据结构 |
| `agents/fault_perception/confidence.py` | `FeatureSet` 加 CHR 派生特征(失败率/SUPI 占比/Gini/SBI 5xx);`_determine_route` 加探索触发(微损带 / 用户失败聚集 / 层间不一致)置于三路由之前;`_gini` 辅助 |
| `agents/fault_perception/router.py` | `max_iterations` dict 加 `EXPLORATION: 40`(否则 KeyError) |
| `agents/fault_perception/agent.py` | `diagnose` 加显式 `elif EXPLORATION` 分支(否则静默走普通 loop);`_run_exploration` 构建 system prompt 并调 explorer |
| `agents/fault_perception/prompt_builder.py` | EXPLORATION skill 注入分支;`_load_skill_l1` 加 `exploration` 子目录 |

### 多算法检测器(`tools/exploration/`)
| 工具 | 算法 |
|---|---|
| `ewma_changepoint.py` | EWMA 均值漂移变点(定位故障 onset) |
| `cusum_changepoint.py` | 单边 CUSUM(对小持续下降更敏感) |
| `pca_residual.py` | PCA Q 统计量残差(结构异常的 link,需 sklearn) |
| `isolation_forest.py` | Isolation Forest 多元孤立点(`random_state` seed,需 sklearn) |
| `ue_failure_concentration.py` | CHR per-SUPI 失败集中度 + Gini + 拓扑签名 |
| `correlated_failure_graph.py` | NE 失败共现图 → 连通分量/度集中度 → single_ne/cluster/scattered |
| `bayesian_fusion.py` | 跨算法贝叶斯后验融合(独立算法一致则乘性增益) |
| `sweep_runner.py` | 元工具:跨 ParamGrid × DataView 并行跑检测器,返回 per-算法 findings + 一致率 |
| `_series.py` | 共享:时序/特征矩阵/Gini/连通分量辅助 |

### 编排与配置
| 文件 | 内容 |
|---|---|
| `agents/fault_perception/parallel_explorer.py` | **从死代码重构为算法编排器**:run_algorithms → fuse → ablation → synthesize;删 `system_prompt[:2000]` 截断;无 LLM 时确定性兜底,有 key 时 LLM 精修 fault_type/推理 |
| `agents/fault_perception/exploration_config.py` | `ExplorationConfig`:默认参数网格、`max_parallel_jobs`、贝叶斯先验、停机准则、消融惩罚 |
| `skills/exploration/exploration_mode.md` | 探索模式 skill:触发条件、强制算法序列、停机准则、输出契约 |

---

## 关键设计点

### 1. CHR 驱动的探索触发(微损/隐患盲区)
探索触发条件(满足任一,**且 CHR 失败率 > 0.3% 噪声底**),置于 WORKFLOW/GUIDED/AUTONOMOUS 之前:
- **微损带**:有链路异常但 `anomaly_severity < 0.03`(LINK 损失 <1%,0.995 阈值看不见)
- **用户失败聚集**:失败 SUPI 占比 ∈ (2%, 30%) 或 per-SUPI 失败 Gini > 0.6
- **层间不一致**:链路 SR 健康(`anomaly_ratio<0.02`)但 CHR SBI 5xx 计数 > 0.5%

### 2. 贝叶斯多算法融合
每个检测器对候选 NE 给出 likelihood ratio;独立算法一致则**乘性增益**。例:6 个检测器都指 AMF_1 → 后验 0.95+,其余 <0.02。

### 3. 消融稳健性(leave-one-out)
逐算法剔除重融合;若剔除任一算法翻转 top 候选 → confidence 降 0.15 并加警示 step。完整 FindingsReport 存 `ReasoningStep` 供离线查。

### 4. LLM 可选
有 API key → LLM 综合 fault_type/推理;无 key → 确定性后验产 DiagnosisResult。**探索模式不依赖 LLM 也能给出正确诊断**(实跑验证)。

### 5. 确定性
所有检测器 seed 自 case_id(IsolationForest `random_state`);同 case → 同 FindingsReport(测了)。

---

## 验收证据(实跑微损用例)

```
routed to: exploration  (score=0.584)        # KPI 模糊,但 CHR 触发探索
diagnosis: fault_elements=['AMF_1'] fault_type=single_ne conf=0.950
ground truth: AMF_1  -> CORRECT
ablation: robust=True (flipped_by=[])
posterior top-3: AMF_1=0.9498, SMF_2=0.0176, SMF_1=0.0141
```

- `pytest tests/` → **64 passed**
- `ruff check .` → **All checks passed**
- 检测器金标准:注入 AMF 故障 → EWMA/CUSUM/PCA/IF/CHR 检测器均 top-1 指向 AMF_1
- 扫描确定性:同 case_id → 同 FindingsReport
- 注册健全:`import_all_tools()` 后 22 个工具 handler 全非 None(含 7 探索工具)
- 端到端:微损 case → `route_taken==EXPLORATION` → reasoning_trace 含 `bayesian_fusion`+`exploration_findings`

---

## 全系统状态(Phase 1 + Phase 2)

- **数据层**:free5GC 忠实 CHR(SUPI/订阅档/PDU 会话/5GMM·5GSM·SBI 原因码),端到端落盘。
- **诊断层**:四路由 —— WORKFLOW / GUIDED / AUTONOMOUS(KPI 置信度)+ **EXPLORATION**(CHR 驱动,多算法框架)。
- 工具:22 个(KPI/拓扑/流/统计 + 7 探索检测器 + sweep_runner + bayesian_fusion)。
- 依赖:新增 `scikit-learn>=1.5.0`(numpy/scipy/pandas 已在)。

### 未做(超出范围)
- 全仓库 `ruff format --check`(46 文件含大量预存未格式化文件,只格式化了本任务新建/重写的文件)。
- 顺带修的 5 个预存 bug 详见 Phase 1 总结。
- 探索模式的 LLM 综合路径需配 `config/llm.local.yaml` 或 `OPENAI_API_KEY` 才生效(确定性路径无需)。
