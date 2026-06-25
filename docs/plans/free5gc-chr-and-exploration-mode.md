# free5GC 忠实数据模型 + 故障感知探索模式

> **状态**:已批准实施 | **日期**:2026-06-25
> **Phase 1**:✅ 已完成并验收(见 `docs/summaries/phase1-free5gc-chr-pipeline.md`)
> **Phase 2**:✅ 已完成并验收(见 `docs/summaries/phase2-exploration-mode.md`)

## Context

当前系统存在两个缺口,直接削弱了诊断能力:

1. **数据层过于合成**:`simulator/` 产出的是聚合 KPI 时序,只有占位 `UE_1..n` 身份,**没有用户级 CHR(呼叫/会话历史)、没有失败原因码(5GMM/5GSM/SBI)**。`free5gc_adapter.py` 是个返回 `None` 的空壳。`CaseSource.FREE5GC` 枚举已存在但无人使用。
2. **诊断层对微损/隐患盲区**:`ConfidenceAssessor` 仅从 KPI 链路级特征算分,`success_rate<0.995` 的硬阈值在 LINK 模式损失 <1% 时几乎无反应。终端原因或正常波动也会让 KPI 轻微下降,无法区分"真网络异常"还是"噪声"。现有三路由(WORKFLOW/GUIDED/AUTONOMOUS)都依赖这个分数,且 `ParallelExplorer`(并行探索)是死代码——被实例化但从不调用,且实现只调 LLM 不调工具。

**目标产出**:Phase 1 让仿真器按 free5GC 真实数据模型(SUPI/订阅档/PDU 会话生命周期/5GMM·5GSM·SBI 原因码)产出 CHR,端到端贯通到诊断 prompt;Phase 2 在真实 CHR 之上构建"探索模式"——用户失败聚集或微损时触发,由 Agent+LLM 编排全套多算法(统计+ML+贝叶斯)做参数扫描与多视图消融,综合出单一诊断结论。

### 已锁定决策(来自澄清)
- **free5GC 集成深度 = 忠实数据模型**:纯 Python,确定性可复现,无 Docker/真实 NF。复用 `free5gc_adapter.py` 作为忠实数据生成器。
- **探索算法 = 全套多算法框架**:EWMA/CUSUM/PCA 残差/Isolation Forest/贝叶斯后验 + 参数扫描 + 多视图消融。
- **交付 = 分两期**:Phase 1 数据管线先行,Phase 2 探索模式在其之上。**Phase 2 受 Phase 1 验收门控**,两期之间停顿复查。

---

## Phase 1 — free5GC 忠实 CHR 数据管线(端到端)✅

### 1.1 新数据结构

**`simulator/free5gc_types.py`(新建)** — 原因码枚举(诊断相关子集):
- `Cause5GMM`(TS 24.501 §9.11.3.2):`ILLEGAL_UE=3`, `PLMN_NOT_ALLOWED=11`, `CONGESTION=22`, `LADN_UNAVAILABLE=43`, `INSUFFICIENT_RESOURCES=67`, `MISSING_OR_UNKNOWN_DNN=27`, `REGISTRATION_REJECT_GENERIC=2`, `MAX_PDU_SESSIONS_REACHED=65` …
- `Cause5GSM`(§9.11.4.2):`INSUFFICIENT_RESOURCES=67`, `REQUEST_REJECTED_UNSPECIFIED=31`, `REQUEST_REJECTED=26`, `NETWORK_FAILURE=38`, `REGULAR_DEACTIVATION=36`, `PDU_SESSION_DOES_NOT_EXIST=39`, `UNKNOWN_PDU_SESSION_TYPE=28` …
- `SBIStatus`(HTTP/2 SBI 传输层):`200/201` 成功,`408` 超时,`429` 拥塞,`500` NF 进程故障,`503` NE 宕机/NRF 注销,`504` 上游超时。
- 故障→原因码映射(驱动 §1.3 逻辑):`LINK`→SBI `503/504`+`NETWORK_FAILURE(38)`;`BUSINESS`→SBI `500`+`REQUEST_REJECTED(_UNSPECIFIED)`;`path_session`→`INSUFFICIENT_RESOURCES(67)`/`UNKNOWN_PDU_SESSION_TYPE(28)`;`resource_pool/dc/all_type_ne`→SBI `429`+`CONGESTION(22)`。

**`simulator/subscriber.py`(新建)** — `SubscriberProfile`(supi `imsi-001010000000001`、imsi、msisdn、dnn、snssai=(sst,sd)、pdu_session_type)、`PDUSession`(pdu_session_id∈1..15、supi、smf/upf 实例、state 机 none→establishing→active→releasing→released、qfi、起止 ts、cause5gsm)、`SubscriberRegistry`(由 `case_id` 确定性生成 `ue_count` 个 SUPI)。`ue_id` 保留为内部 join 键,SUPI 作为新增身份层(不替换)。

**`simulator/models.py`(改)** — 新增 `CHRRecord`:`timestamp, supi, pdu_session_id, procedure_type, msg_hop, nf_src, nf_dst, service(如 Nsmf_PDUSession_CreateSMContext), sbi_status, outcome(success|failure), cause5gmm, cause5gsm, latency_ms, message_name, ue_id`。`SimulationResult` 增加 `chr_records: list[CHRRecord]`、`subscribers`、`sessions`。`NetworkElement` 增加可选 `nf_instance_id/sbi_endpoint/nf_status`(NRF 视图)。

### 1.2 新建/修改文件

| 文件 | 改动 |
|---|---|
| `simulator/free5gc_types.py` | 新建:原因码枚举 |
| `simulator/subscriber.py` | 新建:订阅档/PDU 会话/Registry |
| `simulator/chr_generator.py` | 新建:`CHRGenerator`——把(故障态, 订阅档, 会话, FaultConfig, t)映射为 `CHRRecord`,持有 §1.3 选择逻辑;**用 `random.Random(seed=case_id)` 保证可复现** |
| `simulator/models.py` | 加 `CHRRecord`;扩 `SimulationResult`;NE 加 NRF 字段 |
| `simulator/engine.py` | `simulate()` 在 `create_flows` 后建 Registry+会话;`for t in range(1,61)` 循环内**紧贴**现有 KPIRecord append 调 `CHRGenerator.emit`,故障态触发的 hop 产出失败 CHR,正常态 ~1‰ 背景 SBI 500 作噪声底 |
| `simulator/exporter.py` | 加 `_write_chr_jsonl(case_dir,result)`→`data/case{N}/chr.jsonl`;在 `export()` 调用 |
| `agents/data_generation/simulator_wrapper.py` | 加 `_export_chr_jsonl(result)` 镜像 exporter,写入 `CasePackage` |
| `agents/data_generation/free5gc_adapter.py` | **复用为忠实生成器**:去掉真实连接框架,`generate_case(fault_spec)` 经 CHR 管线产出 `source=CaseSource.FREE5GC` 的 `CasePackage` |
| `agents/shared/models.py` | `CasePackage` 加 `chr_data: str=""`;`CaseData` 加 `chr_records: list[dict]` |
| `agents/shared/storage.py` | `save_case_files` 写 `chr.jsonl`;`load_case_files` 读(缺文件→空 list) |
| `agents/closed_loop.py` | `_load_case_data` 解析 `chr.jsonl`→`chr_records` |
| `api/routes/perception.py` | 解析 `chr.jsonl`→`chr_records` |
| `agents/fault_perception/context_manager.py` | `build_user_message` 末尾追加 CHR 摘要块(top-10 失败尝试:supi/pdu_id/过程/nf_src→nf_dst/sbi_status/cause,≤600 字) |
| `agents/data_generation/validator.py` | `_build_validation_prompt` 加 CHR 失败计数摘要,让 LLM 自校验原因码一致性 |
| `tests/test_chr_pipeline.py` | 新建 `tests/` 目录:可复现性+schema+round-trip+向后兼容测试 |

### 1.3 CHR 原因码选择逻辑(在 `chr_generator.py`)
```
正常态: 99.9% success/200/cause=0; 0.1% 背景 sbi=500 failure(噪声底)
故障态(该 hop 受影响):
  fault_mode==LINK:   sbi=503(NE 宕机)/504(链路超时); cause5gsm=NETWORK_FAILURE(38)
  fault_mode==BUSINESS: sbi=500; 会话过程→REQUEST_REJECTED(_UNSPECIFIED); 注册过程→cause5gmm=REGISTRATION_REJECT_GENERIC(2)
  fpt==PATH_SESSION(ue∈affected_sessions): sbi=500; cause5gsm=INSUFFICIENT_RESOURCES(67)/UNKNOWN_PDU_SESSION_TYPE(28)
  fpt∈(RESOURCE_POOL,DC,ALL_TYPE_NE): sbi=429; cause5gmm=CONGESTION(22)
  outcome=failure
latency_ms: 基线 uniform(8,20); 受影响 hop 故障期 ×3~10
```
**关键约束**:KPI 与 CHR 必须同源——复用 `_is_fault_active`/`_is_link_affected`/`_is_trace_affected`/`affected_sessions` 判定,保证两者指认同一组受影响 hop。

### 1.4 数据流
```
SimulationEngine.simulate(result.chr_records)
 ├─ DataExporter._write_chr_jsonl        → data/case{N}/chr.jsonl        (磁盘路径)
 ├─ SimulatorWrapper._export_chr_jsonl   → CasePackage.chr_data          (内存路径)
 │      └─ Storage.save_case_files       → storage/cases/case_XXX/chr.jsonl
 ▼ load
CaseData.chr_records (closed_loop._load_case_data 或 perception route)
 ├─ context_manager.build_user_message   → LLM 诊断 prompt
 └─ validator._build_validation_prompt   → LLM 自校验
```

### 1.5 Phase 1 风险/坑
- **可复现性**:`CHRGenerator` 必须 seed 自 `case_id`(同 `create_flows(case_id*1000)`),禁用裸 `random.*`。
- **两条持久化路径**:exporter / storage / wrapper 三处的 `chr.jsonl` schema 必须一致;round-trip 测试覆盖。
- **向后兼容**:旧 case 目录无 `chr.jsonl`→`load_case_files` 返回空 list,不报错(`CaseMetadata.from_json` 已前向兼容)。
- **数据量**:60s×50UE×~12hop 可能数万行 CHR;`chr.jsonl` 是事实源,**仅摘要入 prompt** 防止 token 爆炸。
- **身份 join**:CHRRecord 保留 `ue_id`,与现有 KPI↔flow join 兼容;SUPI 是叠加身份。

### 1.6 Phase 1 里程碑
M1.1 枚举+订阅档/会话模型+单测 → M1.2 `CHRGenerator` 独立测试 → M1.3 接入 `simulate`,断言 KPI↔CHR 一致 → M1.4 持久化(exporter+storage+wrapper round-trip)→ M1.5 四个消费者(closed_loop/perception route/context_manager/validator)→ M1.6 复用 `free5gc_adapter` 为忠实生成器,跑 `CaseSource.FREE5GC` 批量。

### 1.7 Phase 1 验收
- `python -m pytest tests/test_chr_pipeline.py -q`
- 冒烟:`SimulatorWrapper.generate(...)`→`CasePackage.chr_data` 非空可解析,SUPI 格式 `imsi-00101...`,pdu_id∈1..15,cause∈枚举
- `python -m agents.closed_loop --cases 5` 跑通,`CaseData.chr_records` 进诊断 prompt
- 同 case_id/seed→`chr.jsonl` 字节一致(哈希);旧目录无 chr.jsonl→空 list 不报错
- `ruff check .` 通过(line-length 100)

> ⏸ **Phase 1 完成并验收后停顿复查,确认再进入 Phase 2。**

---

## Phase 2 — 探索模式(多算法框架,基于真实 CHR)

### 2.1 触发条件(在 `confidence.py`,精确)
满足任一即返回 `Route.EXPLORATION`(置于 WORKFLOW/GUIDED/AUTONOMOUS 判定**之前**):
- **微损带**:有链路异常但 `anomaly_severity < 0.03` 且 `anomaly_ratio > 0`(当前进 ambiguity 路径的子集)——LINK 损失<1%,现有启发式看不见。
- **用户级失败聚集**(来自 CHR):失败 SUPI 占比 ∈ (0.02, 0.30)(部分失败,非灾难)或 per-SUPI 失败集中度 Gini > 0.6。
- **层间不一致**:链路 SR 看似正常(`anomaly_ratio` 低)但 CHR SBI 5xx/429 计数 > 0——链路说健康,CHR 说有病。

需给 `_extract_features` 增加 CHR 派生特征(失败 SUPI 数、原因码分布、SBI 5xx 计数)加入 `FeatureSet`。

### 2.2 `Route.EXPLORATION` 必须更新的全部分派点(逐行)
1. `agents/shared/models.py:22-25` — Route 加 `EXPLORATION="exploration"`
2. `agents/fault_perception/router.py:20-24` — `max_iterations` dict 加 `Route.EXPLORATION: 40`(**否则 KeyError**)
3. `agents/fault_perception/agent.py:149-156` — `else`(AUTONOMOUS)**之前**加显式 `elif assessment.route == Route.EXPLORATION:`→`_run_exploration(...)`(**否则静默走普通 loop,功能失效**)
4. `agents/fault_perception/prompt_builder.py:74-85` — 加 `elif mode == Route.EXPLORATION:`→加载 `exploration_mode` skill L1
5. `agents/fault_perception/confidence.py` — 触发逻辑(§2.1)。顺带把硬编码 `THRESHOLD_HIGH/LOW` 及新探索阈值收进新 `ExplorationConfig` dataclass(默认值=现常量,保持既有路由行为不变)

### 2.3 重构 `parallel_explorer.py` 为算法编排器(保留类名与 `explore` 签名,避免动 `agent.py:110`)
```python
async def explore(self, case_data, hypotheses, system_prompt, session_id) -> DiagnosisResult:
    views  = self._build_views(case_data)            # link_kpi / trace_kpi / chr_attempt / per_supi_ts
    grid   = self._build_sweep_grid(self.config)     # ParamGrid
    findings = await self._run_algorithms(views, grid, session_id)  # asyncio.gather (算法×视图×参数)
    fused  = self._bayesian_fusion(findings)         # 跨算法后验融合
    result = await self._llm_synthesize(fused, case_data, system_prompt, session_id)
    return result
```
**核心变化**:并行单元是**带参数扫描的检测器工具调用**,不是 LLM-only 探针。删除 `system_prompt[:2000]` 截断——synthesis 步接收完整 system prompt + 结构化 `FindingsReport`。`max_paths` 改义为 `max_parallel_jobs`。

### 2.4 新检测器工具模块(新建 `tools/exploration/`,遵循 `tools/statistical_tools.py` 装饰器模式)
均在 `registry.import_all_tools` 加 import 行**和** `tool_modules` 列表(缺一→handler 为 None→dispatch 返回"no handler"):
1. `ewma_changepoint.py` — EWMA 均值漂移变点;扫描 `lambda_∈{.1,.2,.3}`, `threshold_sigma∈{2,3,4}`
2. `cusum_changepoint.py` — 单边 CUSUM;扫描 `drift_k∈{.005,.01,.02}`, `threshold_h∈{4,5,6}`
3. `pca_residual.py` — PCA 残差 Q 统计量;扫描 `n_components∈{2,3,4,5}`, `alpha∈{.01,.05}`(需 sklearn)
4. `isolation_forest.py` — 多元孤立点;扫描 `n_estimators∈{100,200}`, `contamination∈{.03,.05,.1}`(需 sklearn)
5. `bayesian_fusion.py` — 离散贝叶斯后验融合,先验来自拓扑均匀性,输出按后验排序
6. `ue_failure_concentration.py` — CHR per-SUPI 失败集中度 + Gini,判单一 NE 对(scattered→multi_ne)还是星形(single_ne)
7. `correlated_failure_graph.py` — NE/SUPI 失败时序共现相关图,连通分量+模块度,区分 dc/resource_pool(稠密团)vs multi_ne(散)
8. `sweep_runner.py` — **元工具**:agent loop 调它跑指定检测器跨 `ParamGrid`×`DataView`,返回 `FindingsReport`;内部 `asyncio.gather` 调 registry 检测器

### 2.5 扫描/消融数据结构(加 `agents/shared/models.py`)
```python
@dataclass ParamGrid: algorithm, data_view, params: dict[str,list]
@dataclass SweepCell: algorithm, data_view, params: dict, finding: dict,
                     evidence_elements: list[str], confidence: float
@dataclass FindingsReport: cells: list[SweepCell],
                     param_concordance: dict[str,float],  # 参数集一致率
                     view_concordance: dict[str,float],   # 视图一致率
                     bayesian_posterior: list[tuple[str,float]],
                     used_algorithms: list[str],
                     ablation_summary: dict
```
`ExplorationConfig` 持默认网格、`max_parallel_jobs`、融合先验、消融开关。

### 2.6 综合为单一 DiagnosisResult
`bayesian_fusion` 产出排序后验;`_llm_synthesize` 接 `FindingsReport` 作结构化 user message,令 LLM:取后验 top 元素为 `fault_elements/fault_links`(用 Phase 1 身份层把 SUPI→session、NE 对→link 映射);`confidence`=max 后验;整个 `FindingsReport` 作 `ReasoningStep(step_type="tool_result")`;**消融翻转 top 候选→confidence 降 0.15 并加警示 step**;`route_taken=EXPLORATION`。LLM 是综合推理者(满足"Agent+LLM+算法"),重活确定性可复现。

### 2.7 EXPLORATION skill — `skills/exploration/exploration_mode.md`
注入 via prompt_builder。规定强制序列:(1) `sweep_runner` 跑 EWMA+CUSUM on link_kpi→定位 onset ts;(2) PCA 残差+IsolationForest on per_link→候选元素;(3) `ue_failure_concentration`+`correlated_failure_graph` on chr_attempt→拓扑聚类签名;(4) 全部 `SweepCell` 喂 `bayesian_fusion`→后验;(5) 消融:逐算法剔除,看后验排序是否翻转。停机准则:top 后验>0.6 且 ≥2 独立算法一致。

### 2.8 依赖
`pyproject.toml` 加 `scikit-learn>=1.4`(numpy/scipy/pandas 已在)。sklearn import 在 `pca_residual/isolation_forest` 模块顶;`import_all_tools` 按 module try/except 包裹,缺失可选依赖仅禁用这两个工具而非崩全部。检测器随机性(IsolationForest `random_state`)seed 自 `case_id`。

### 2.9 Phase 2 风险/坑
- **`else` 分支陷阱**(`agent.py:154`):EXPLORATION 不显式 elif→静默走普通 loop,功能失效。必须显式分支。
- **`router.py` KeyError**:dict `[assessment.route]` 查找,EXPLORATION 不加则崩。
- **`system_prompt[:2000]` 截断**:重构必须删除,否则 skill+context 被截。
- **token 预算**:全网格×4 视图 `FindingsReport` 巨大;封顶 `max_parallel_jobs`,prompt 只放 top-k concordance 的 `SweepCell`,完整报告存 `ReasoningStep` 供离线查。
- **确定性**:所有检测器 seed 自 `case_id`,消融可复现。
- **Route 向后兼容**:EXPLORATION 仅新增不删旧,`Route(value)` 解析旧 WORKFLOW/GUIDED/AUTONOMOUS 不受影响。
- **工具注册**:import 行 + tool_modules 两处都要改;加单测断言探索工具 handler 非 None。

### 2.10 Phase 2 里程碑
M2.1 `Route.EXPLORATION`+路由/agent/prompt_builder/confidence 接通(仅触发,无算法),微损 case 路由到 EXPLORATION → M2.2 EWMA+CUSUM+sweep_runner+ParamGrid/SweepCell/FindingsReport 模型 → M2.3 sklearn 依赖+PCA 残差+IsolationForest → M2.4 CHR 上的 ue_failure_concentration+correlated_failure_graph → M2.5 bayesian_fusion+ExplorationConfig → M2.6 重构 `ParallelExplorer.explore` 为编排器,接 `_run_exploration` → M2.7 `exploration_mode.md` skill+注入 → M2.8 消融框架+翻转降置信 → M2.9 端到端:Phase 1 数据集上 EXPLORATION vs AUTONOMOUS 在微损/部分失败子集的 P/R/F1。

### 2.11 Phase 2 验收
- `python -m pytest tests/ -q`(检测器+sweep+fusion+路由分派)
- 检测器金标准:已知注入故障→top-3 含被注入元素
- 扫描确定性:同 case_id→`FindingsReport` 哈希一致
- 注册健全:`import_all_tools(); assert all(t.handler is not None ...)`
- 端到端:生成 free5gc 忠实微损 case(loss_rate≈0.005),`diagnose`→`route_taken==EXPLORATION`,reasoning_trace 含 `SweepCell`,`confidence==` 后验
- `ruff check . && ruff format --check .` 通过

---

## 执行顺序与关键文件

**两期顺序执行,Phase 1 验收门控 Phase 2。** 实现 Python ≥3.11、ruff line-length 100、pytest asyncio_mode=auto;新建 `tests/` 目录(此前为空)。

关键文件:
- `simulator/engine.py`(CHR 发射点)、`simulator/models.py`(CHRRecord/SimulationResult)
- `simulator/free5gc_types.py`、`simulator/subscriber.py`、`simulator/chr_generator.py`(新建)
- `agents/shared/models.py`(CasePackage/CaseData/Route/扫描数据结构)
- `agents/shared/storage.py`、`agents/data_generation/simulator_wrapper.py`、`agents/data_generation/free5gc_adapter.py`
- `agents/fault_perception/confidence.py`(触发)、`agent.py`(EXPLORATION 分派)、`parallel_explorer.py`(编排器重构)、`prompt_builder.py`
- `tools/exploration/*`(7 检测器+sweep_runner)、`tools/registry.py`、`skills/exploration/exploration_mode.md`
- `pyproject.toml`(scikit-learn)
