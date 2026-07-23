# 流控溯源场景 D / E — 实施总结

## 概述
为 frontend-flow 与 frontend-show 新增**流控溯源**场景 D、E,体现高稳智能体对"业务冲击"
(非网元硬故障)的处置:物联网平台故障 → 物联终端反复上线 → 注册风暴冲击 AMF、PDU 会话风暴
冲击 SMF。智能体经 UPF UFDR 报表溯源(SST=3 物联切片注册突增 + 物联 DNN 会话突增)定位到
物联终端群体,并按两种流控策略(均属探索)分别收敛。两前端为**独立并行副本**,改动各做一遍。

## 场景定义
| 场景 | 策略 | 路由 | 推理(phase4)→ 执行(phase5)→ 验证(phase6) |
|------|------|------|------|
| **D** | 策略1·溯源到 UE | GUIDED(0.55) | CPU 过载+注册风暴 → 溯源物联终端 → **决策** UE 侧 back-off → 执行 Reg Reject+back-off → 验证收敛(**D 不取 SST=3/APN**) |
| **E** | 策略2·溯源到 AMF+SMF | AUTONOMOUS(0.30) | 首轮:决策策略1(UE back-off)→ 执行 → **未收敛** → 二轮拉取 UFDR(**此时才取 SST=3/APN**)→ 溯源 AMF(NSSAI)/SMF(APN) → 决策策略2 → 执行双通道限流+比例算法 → 验证收敛 |

**推理逻辑(修正)**:phase4 推理只到"**决策**"(发什么消息/采取什么流控),**不提前宣告恢复**;
恢复在 phase5 执行、phase6 验证才确认。E 的 SST=3 与物联 DNN/APN 是**第二轮循环**(策略1 失败后)
才获取的,**D 不需要**(D 仅凭注册风暴即可溯源到 UE)。

- 共同:`faultType = "iot_storm"`(business)、`elements = [AMF_1/2/3, SMF_1/2]`(被冲击 NE,
  非硬故障)、`predicted.elements = []`(根因是物联终端群体,不隔离网元)。
- KPI:复用 `buildKpiFor(graph, fault)` → AMF/SMF 节点及业务边按 lossRate 下跌、整网微跌,
  呈现"AMF/SMF 被冲击 + 全网微损、网元非硬故障"。
- **UFDR 弹窗**:仅 E 在 phase4(二轮)渲染;D 无 ufdr 字段,不显示 SST=3/APN。

## 改动文件(每前端一份,结构一致)

### 数据层
- `data/types.ts`:新增 `UfdrReport`、`FlowControl` 类型;`Scenario` 增 `ufdr?`、`flowControl?`。
- `data/real.ts`:`ScenarioNarrative` 增 `ufdr?`、`flowControl?`(+ import)。
- `data/constructed.ts`:新增 `FAULT_D/E`、`REASONING_D/E`、`CONFIDENCE_D/E`、`EVAL_D/E`、
  导出 `SPEC_D/E`。
- `data/scenarios.ts`:`NARRATIVES.D/E`(cn/en/tagline/intro/objective/pillars/comparison/
  ufdr/flowControl/skillEvolution),追加进 `SCENARIOS`。`ScenarioTags` 自动纳入 D/E。

### 故事板
- `story/types.ts`:`StoryState` 增 `cpuOverloadNe`、`ufdrPopup`、`flowControlPopup`。
- `story/director.ts`:
  - `ALGO_REASON.D/E`(phase4 算法链:CPU 过载检测 → UFDR 溯源 → SST=3/DNN 突增 → 溯源物联终端;
    E 加策略1 未收敛 → 策略2 限流+比例)。
  - `SCENARIO_SUB.D/E`(各相位副标题)。
  - `recoveryActionsFor` 新增 `case "iot_storm"`:按 `s.id` 分支(D→Reg Reject+back-off;
    E→NSSAI/APN 限流+比例)。`cordonedFor` iot_storm → [](不隔离)。
  - `direct()` 新派生:`cpuOverloadNe`(phase≥2)、`ufdrPopup`(phase4)、`flowControlPopup`(phase5)。

### 视图层
- `components/DigitalTwin/DigitalTwin.tsx`(两端):
  - 节点 CPU 过载角标(AMF/SMF 琥珀角标,`state.cpuOverloadNe` 驱动)。
  - `UfdrCallout`(phase4):SST=3 注册突增 + 物联 DNN 会话突增双条形 + 溯源结论。
  - `FlowControlCallout`(phase5):D=Reg Reject+back-off;E=AMF NSSAI / SMF APN 限流比例条 + PID 算法 + 收敛。
- **frontend-flow**:其 `showCallouts=false`(单弹窗模式),UFDR/FlowControl 在 `PhasePopup`
  内以 HTML 卡渲染(P4 末 UFDR 摘要、P5 末 FlowControl 卡)。`data/llm.ts` 对 D/E 的 phase4/5/7
  定制方法(phase4=algo UFDR 溯源、phase5=rule 流控策略、phase7=llm 故障报告总结)。
  `components/SolutionFlow/AgentLoop.tsx` 三条回环标签**通用化**(覆盖"换策略/补采数据"),
  兼容 A–E 全场景。
- **frontend-show**:`showCallouts=true`,UfdrCallout/FlowControlCallout 直接在拓扑上渲染;
  面板(RecoveryPanel/ReasoningTrace/ComparisonPanel 等)数据驱动,D/E 自动流转。

## 关键设计点
- **AMF/SMF 不隔离**:流控溯源中网元是被冲击方,`cordonedNe=[]`,恢复=流控(Rate-Limit)
  而非隔离/切换。拓扑上以 CPU 过载角标 + 劣化 KPI 表现冲击。
- **E 的 2 轮探索**:推理链含"策略1 UE back-off(终端不支持→未收敛)→ 策略2 网络侧限流(收敛)",
  FlowControlCallout 展示双通道(NSSAI/APN)比例条 + PID 算法。
- **方法按需标注**(frontend-flow):分析区区分 🤖 大模型 / ⚙ 规则 / 🧮 算法 —— D/E 仅
  phase1/7 用大模型(校验+故障报告总结),phase2/4 为算法,phase3/5/6 为规则。

## 验证
- `cd frontend-flow && npm run build` ✅(tsc --noEmit + vite build,410 模块)
- `cd frontend-show && npm run build` ✅(414 模块)
- 运行:`npm run dev`(frontend-flow :5175 / frontend-show :5174),切换 D → AMF/SMF CPU 过载
  角标 → UFDR 溯源弹窗(SST=3 + 物联 DNN) → 流控弹窗(Reg Reject+back-off)→ 收敛 → 评估沉淀;
  切换 E → 同检测/溯源 → 策略1 未收敛 → 策略2(NSSAI+APN 限流+比例条)→ 收敛。
- 左侧方案图 3 条回环为通用文案,切换 A–E 均成立。

## 复用
`buildConstructedScenario`、`buildKpiFor`(kpi.ts)、现有 callout 锚定/样式(DigitalTwin.tsx)、
`recoveryActionsFor/cordonedFor`(director.ts)、`ScenarioTags`(自动纳入新场景)。

## 第二轮细化(场景逻辑 + 现象 + 数据)
- **推理逻辑修正**:phase4 推理只到"决策"(发什么消息/采取什么流控),**不提前宣告恢复**;
  恢复在 phase5 执行、phase6 验证才确认。D 不取 SST=3/APN;E 的 SST=3 + 物联 DNN 是**第二轮循环**
  (策略1 失败后)才获取。
- **E 改 20% back-off**:首轮仅约 20% 物联终端支持 back-off timer,过载降低但未消除、仍过载 → 启动第二轮(非"终端不支持")。
- **流控扩散影响 2C 手机**:D/E intro + StormMetrics.impact2c 体现"流控扩散至 2C 手机(注册/会话被限流、无法上网)";
  策略起效后正常用户上网恢复,物联平台恢复后物联终端快速收敛。
- **过载告警 + 突增 KPI**:新增 `StormMetrics`(AMF/SMF CPU% + 注册/PDU 会话突增% + 2C 影响),phase2 渲染
  (frontend-flow PhasePopup 风暴指标卡;frontend-show StormMetricsCallout)。CPU 过载亦以 AMF/SMF 节点角标呈现。
- **比例算法依据**:E `FlowControl.ratio.basis` = "依据 AMF/SMF 容器容量、实时流量、CPU 负载做反压/自保流控,PID 实时调节";
  FlowControlCallout/PhasePopup 展示双通道比例条 + 计算依据(反压/自保)。
- **大模型故障报告**:新增 `FaultReport`(根因/现象/影响/处置/结果),phase7 渲染
  (frontend-flow PhasePopup P7 报告块;frontend-show EvaluationPanel FaultReportBlock)。

## frontend-flow AgentLoop 修正
- **回环点亮时机**:loop①(⑤输出评估→A1)改为**仅 step⑤ 激活时**亮(`active===5`),不再整段 phase4(根因定位)提前亮;
  loop② phase5-6、loop③ phase7。
- **放大**:节点 HW 54→62 / NH 34→40、字号(步骤名 13.5→15.5、序号 17→20、Agent 标题 12→13.5)。
- **6 步加框**:两行蛇形主干整体以虚线框包裹("故障感知 Agent · 内部 6 步流程")。

## 待办(本轮未做,转入后续)
- 拓扑横向→竖向(两前端)、弹窗避让/左置:视觉布局调整,因风险较大且与"实时仿真数据模式"新方向有重叠,转入后续迭代。

