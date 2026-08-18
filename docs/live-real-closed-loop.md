# LIVE 真实闭环改造设计(去剧本化)

> 目标:LIVE 模式做到「完全真实的仿真 + 真实三 Agent 闭环」,且实现**通用**(无 per-scenario 定制)。
>
> **状态:已实现并验证**(2026-08-17)。验证结果见文末「验证记录」。

## 模块清单(改造后)

| 模块 | 职责 |
|------|------|
| `simulator/models.py::FaultConfig` | +`surge_multiplier`/`surge_filter`(业务激增)、`loss_filter`(按类别的网元丢损,如 gNB 仅对物联终端群体异常) |
| `agents/simulation/realtime_engine.py` | 分类到达模型;流控按 flt 生效;UE back-off 按终端支持率折减;准入拒绝与拥塞拒绝语义分离;`traffic_class_stats()` 失败类别归因;`load_reduction_hint()`(未截断虚拟 CPU 反解);`runtime_context()` |
| `agents/simulation/policy_planner.py` | **通用策略规划器**(替代已删除的 policy_resolver):诊断+遥测推导,无剧本 |
| `agents/simulation/fault_validator.py` | **Agent 1 实时形态**:注入前影子自校验(5 维,不合理自动调参重试) |
| `agents/shared/realtime_runner.py` | 真实多轮闭环(MAX_ROUNDS=3,由 `engine.is_recovered()` 真实驱动);接线三 Agent |
| `agents/fault_perception/deterministic_diagnoser.py` | stub LLM(无 key)降级路径:同构工具链确定性诊断(含均质化比较 `_degradation_exclusivity`) |
| `agents/fault_perception/workflow_engine.py` | +`overload_admission_workflow`(过载确定性工作流) |
| `agents/fault_perception/confidence.py` | +CPU 遥测特征(过载不再误判 normal);single_ne 判定抗伙伴噪声(dominance>0.5 优先) |
| `agents/evaluation/live_report.py` | **Agent 3 实时形态**:真值比对(复用 Evaluator)+ 恢复效果 + 优化建议 + Skill 沉淀 |
| `agents/shared/llm_client.py` | `effective_mode`/`LLMStubModeError`:stub 模式真实接线(不打无 key 请求) |

## 验证记录(2026-08-17)

- **测试**:`tests/` 166 全过;e2e(`tests/integration/live/test_realtime_all_scenarios.py`)连跑 8 次稳定。
- **A~G 全场景**(stub LLM 确定性路径):影子校验通过 → 诊断定位正确(最终轮)→ 通用规划器策略 → 1 轮恢复(风暴/网元类)或 2-3 轮(个别种子首轮误诊被闭环救回)。
- **误诊诚实性**:固定误诊(真 UPF_1 诊成 SMF_2)→ 隔离 SMF_2 → 真实不恢复 → round_change/confidence_low 逐轮升级 → MAX_ROUNDS 后评估诚实失败(recovered=False,误报/难例回流建议)。
- **真 LLM(MiniMax M3)**:A(guided→agent loop)定位 UPF_1 精确匹配恢复;D(workflow→过载工作流)path_session+traffic_filter → 三层准入 → 恢复 + 类别命中。
- **通用性**:场景表仅含故障/流量规格(测试断言无 recovery_actions/recovery_actions_r1/expected_rounds 字段);新增场景无需改任何代码。

## 增补:frontend-flow-studio LIVE 达到 DEMO 等效效果(2026-08-18)

用户实测发现「LIVE 未按预期运行」的三个根因与修复:

| 根因 | 修复 |
|------|------|
| **前端致命 bug**:liveBus store 原地 mutate → `useSyncExternalStore` snapshot 引用永不变 → LIVE 事件(推理链/策略/评估)到达后**从不触发重渲染**,面板冻结在点击瞬间的快照 | `applyEvent` 末尾不可变发布(`_store.set(sid, {...st})`)→ 事件驱动渲染恢复(demo 与 studio 同修) |
| **④又慢又偶发误诊**:A/B 路由 guided → 真 LLM 45~170s 且端点并列时选错 NE;workflow 引擎只有计数 tie-break | ① `workflow_engine.link_fault_workflow` 加**均质化比较**(`degradation_exclusivity` 提为 `tools/kpi_analyzer` 共享函数);② runtime_context 增 `ne_degradation_ranking`(LLM 可见的独占率证据);③ 路由层新规则:**single_ne + 独占率≥0.9 + 严重度≥0.05 → WORKFLOW**(确定性铁证秒级定位;微损 B 仍 guided 保留 CHR 降噪戏码);④ agent loop 历史截 20→12 条提速 |
| **交互无反馈**:重复点②重新注入故障;④进行中无进度 | runner 幂等(已注入→仅刷新异常检测)+ ④忙碌守卫(`control_note` 提示,前端角标显示)+ `agent_step` 心搏 reasoning_step |

新增真实数据事件(④弹窗 DEMO 等效、全真实):
- `chr_insight`:真实 CHR 原因值分布 + 共因 NF + 类别归因(引擎 `chr_insight()`)
- `homogen_report`:真实均质化比较(实例级 SR 对比 + exclude/root/partial 判定 + 独占率锚定,引擎 `homogen_report()`)
- 前端:studio ReasonPanel 渲染「均质化比较 · 实时遥测」「CHR 洞察 · 实时」卡;demo 的画布锚定弹窗(chrPopup/homogenPopup)由 mergeLive 用真实数据覆盖;MatchPanel 的「匹配逻辑」LIVE 下用真实特征→分数→路由文案

数据旋钮:`LiveScenario.terminal_noise`(终端侧既有 CHR 噪声,B=0.04 → 「网络微损+终端噪声」的真实模糊源)。

Diagnoser 事件双写(bus + recorder):`confidence_assessment/anomaly_detection/reasoning_step/diagnosis_complete/chr_insight/homogen_report` 全进 events.jsonl,`/replay` 完整。

**验证**:166 测试全过;studio `verify.mjs` 全 PASS(含 LIVE 真实走查:②真实异常链路+工具聚合定位 → ③真实置信度+路由徽章「实时」 → ④确定性工作流 10 秒定位 UPF_1 + 均质化/CHR 实时卡 → ⑤通用规划器策略(带 rationale)→ ⑦实时评估恢复);路由分布 A 22/25 workflow、B 20/25 guided、C 18/25 workflow、D~G 全 workflow;workflow 诊断 25 种子零误。

## 现状问题(改造前)

| # | 问题 | 位置 |
|---|------|------|
| 1 | 恢复策略 = per-scenario 剧本配方(`recovery_actions`/`recovery_actions_r1`),诊断结果基本被无视 | `live_scenarios.py` / `policy_resolver.py` |
| 2 | 轮次 = `expected_rounds` 剧本;首轮**故意**用弱策略、二轮用完整配方,必然「二轮成功」 | `realtime_runner.handle_evaluate` |
| 3 | 即使误诊,策略仍打中正确 NE → 永远恢复 → 评估永远通过(不真实) | `policy_resolver._resolve_ne`(恒返回配置 NE) |
| 4 | Agent 1 未接入(故障注入无校验);Agent 3 是内联 `_build_evaluation`,非真评估 Agent | `realtime_runner` |
| 5 | 风暴仿真:flow_control 的 `flt` 过滤器**未生效**(全量削流);UE backoff 终端支持率**未生效**;风暴靠场景标志 `is_storm` 而非故障模型 | `realtime_engine._arrivals_for_tick/_compute_throttle` |
| 6 | 无 LLM key 时 GUIDED/AUTONOMOUS 必失败(`_resolve_mode` 未接入 `chat()`) | `llm_client.py` / `agent.py` |
| 7 | 置信度评估器看不到 CPU/到达率遥测 → 风暴类(business/path_session)在 link KPI 无异常时误判 normal | `confidence.py` |

## 改造方案(全部通用)

### 1. 引擎真实性(`simulator/models.py` + `agents/simulation/realtime_engine.py`)
- `FaultConfig` 增加 `surge_multiplier`(到达放大倍数)与 `surge_filter`(激增的业务类别过滤)——风暴成为**故障模型**的一部分,不再依赖场景标志。
- `flow_control` 策略按 `flt` 分类生效:λ 按 (sst,dnn) 类别拆分,只削减匹配类别;UE 层 backoff 按该类别**终端支持率**折减(不支持 back-off 的终端继续冲击),AMF/SMF 准入全效。
- 新增 `traffic_class_stats()`:CHR 失败 × UE 绑定 → 失败类别归因(sst/dnn/device_type/gNB 占比 + 主导类别)。
- `snapshot_for_agent()` 附 `runtime_context`(ne_cpu、到达率、类别归因)——Agent 可见的运行时遥测。
- ground truth 对 business 故障附 `fault_classes`。

### 2. 通用策略规划器(新 `agents/simulation/policy_planner.py`)
`plan_recovery_actions(diagnosis, engine_view, round_no) -> list[PlannedAction]`,从「诊断结果 + 网络遥测」推导,无剧本:
- **过载类**(fault_mode=business / path_session / 遥测 CPU≥80):类别过滤(诊断 `traffic_filter` 或引擎类别归因)→ AMF/SMF 准入限流(ratio 由引擎减载提示按实测 CPU 差值计算)+ UE back-off;下游 NF(UDM 等)过载 → 在上游 AMF/SMF 限流(拓扑通用规则)。
- **网元类**(link/single_ne…,有具体 NE):核心 NF → 隔离 + 会话重选(需存在健康同型实例);gNB/业务面 → 仅用户侧重选(不隔离网元)。
- **空诊断**:遥测兜底(过载→流控;退化链路→聚合 top NE)。误诊 → 策略打错对象 → 不恢复(诚实)。
- **轮次 = 反馈控制**:每轮按当前 CPU/SR 与目标差值重算所需削减,策略叠加增强,而非换剧本。
- 动作文案通用生成(cn/en/layer)。

### 3. 真实多轮 runner(`realtime_runner.py`)
- `handle_apply_policy`:策略全部来自规划器。
- `handle_evaluate`:真实 `is_recovered()`;未恢复 → `round+1`(≤MAX_ROUNDS=3)→ 真二轮(再观察数据段 + 重异常检测 + 重置信度 + 重诊断 + 加强策略)→ 再判;恢复或达上限 → Agent 3 真评估。
- `handle_inject_fault`:**Agent 1 影子自校验**——在影子引擎上预演(健康段+故障段),校验故障数据合理性(可检测、幅度合理、拓扑一致、流程有效),不合理自动调参(loss×1.8 / surge×1.5,≤3 次)后注入 → 发 `data_validation`(5 维灯,同 Agent 1 校验器维度)。

### 4. Agent 2 适配
- `submit_diagnosis` schema + `traffic_filter`(业务故障类别,LLM 可给);`DiagnosisResult.traffic_filter` 字段。
- 诊断 prompt 附 `runtime_context`(CPU/到达率/类别归因)。
- 置信度评估器新增 CPU 遥测特征:多 NF 过载 → all_type_ne/过载模式(修复风暴误判 normal 的盲区);批量路径(CaseData 无 runtime_context)不受影响。
- `WorkflowEngine` 新增 `overload_admission_workflow`(过载确定性工作流:KPI 异常 → 类别归因 → path_session 诊断)。
- stub 模式接线:`_resolve_mode` 接入 `chat()`;GUIDED/AUTONOMOUS 在 stub 下走确定性工具链诊断(`deterministic_diagnoser.py`)——无 key 也给出诚实诊断。

### 5. Agent 3 真接入
- 真值比对复用 `agents/evaluation/evaluator.py`(P/R/F1/exact_match)。
- 新增恢复效果维度(recovered、轮数、恢复前后 SR/CPU)+ 优化建议(规则生成,LLM 可选增强)→ `evaluation_report`(兼容旧形状,超集)+ `skill_evolved`。

### 6. 场景表纯化(`live_scenarios.py`)
- 删除 `recovery_actions` / `recovery_actions_r1` / `expected_rounds`。
- FaultConfig 带 surge 参数;故障/流量刻度按「信号清晰度分层」标定(A 清晰→WORKFLOW、B 中等+噪声→GUIDED、C 模糊→AUTONOMOUS/EXPLORATION、D 风暴→过载)。
- `route_expectation` 保留为测试期望元数据,运行时不读。

### 7. 前端(`frontend-flow-demo`)
- liveBus 处理 `round_change`/`confidence_low`/`data_validation`;`recovery_action` 带 round/layer;recoveryActions 按轮分组。
- mergeLive:round 取 live;loopBackKind/评估面板由 live 评估结果驱动。
- GuidedStage 圆圈按 (phase, round) 定位;DispatchPanel 场景 D 分支优先展示 live 动作。

### 8. 测试
- planner 单测:正确诊断→恢复;误诊→不恢复;风暴→类别限流(ToC 不受影响)。
- runner 闭环:正确诊断→1 轮恢复+精确匹配;误诊→诚实不恢复;风暴 backoff 部分支持→多轮反馈收敛。
- 影子校验单测;A~G 全场景 e2e(真实组件 + 桩 LLM);回归 confidence/workflow/batch。
