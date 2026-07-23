# 流控溯源场景 D / E — 计划

## 背景
两个演示前端(frontend-flow / frontend-show)原有 A/B/C 三场景,都偏"网元故障定位 + 隔离恢复"。
需新增一类**流控溯源**场景:物联网平台故障 → 物联终端反复上线 → 注册风暴冲击 AMF、PDU 会话
风暴冲击 SMF。智能体溯源到冲击源,并按两种流控策略(均属探索)分别处置,生成场景 D、E。
同时让 frontend-flow 左侧方案图更通用(覆盖 A–E),文档落 docs/plans、docs/summaries。

## 共享故事(D/E 检测与定位一致,仅策略不同)
- **触发**:AMF/SMF 容器 CPU 过载告警 + KPI 受影响;AMF 携带 PDU 请求的上行 NAS、SMF N11
  PDU 建立请求明显突增。
- **定位(UPF UFDR 报表溯源)**:① Registration Request 中 Requested NSSAI SST=3(MIoT) 突增;
  ② PDU 会话建立中物联 DNN/APN 突增 → 溯源到物联终端群体。
- **根因**:物联网终端群体(非网元硬故障,AMF/SMF 为被冲击方,不隔离)。
- **D**(策略1·溯源到 UE):AMF Registration Reject + back-off timer → 收敛。GUIDED。
- **E**(策略2·溯源到 AMF+SMF):UE 不支持 back-off → AMF 限 NSSAI + SMF 限 APN,比例算法
  实时调节 → 收敛。AUTONOMOUS(2 轮探索)。

## 数据建模(每场景,两前端各一份)
- `constructed.ts`:`FAULT_D/E`(faultType `iot_storm`、business、elements=AMF/SMF)、
  `REASONING_D/E`、`CONFIDENCE_D/E`(D guided 0.55 / E autonomous 0.30)、`EVAL_D/E`、`SPEC_D/E`。
- `kpi.ts`:复用 `buildKpiFor(graph, fault)`(AMF/SMF 按 lossRate 下跌、overall 微跌)。
- `types.ts` + `real.ts`:新增 `UfdrReport`、`FlowControl` 类型 + `Scenario/ScenarioNarrative.ufdr/flowControl`。
- `scenarios.ts`:`NARRATIVES.D/E`(含 comparison/ufdr/flowControl/skillEvolution),追加 `SCENARIOS`。
- `story/types.ts`:`cpuOverloadNe / ufdrPopup / flowControlPopup`。
- `story/director.ts`:`ALGO_REASON.D/E`、`SCENARIO_SUB.D/E`、`recoveryActionsFor` iot_storm 分支
  (D→Reg Reject+back-off;E→NSSAI/APN 限流+比例)、`direct()` 新派生态。

## 新弹窗
- **CPU 过载角标**(两端 DigitalTwin 节点):AMF/SMF 琥珀角标,`state.cpuOverloadNe` 驱动。
- **UfdrCallout**(phase 4):SST=3 注册突增 + 物联 DNN 突增双条形 → 溯源结论。
- **FlowControlCallout**(phase 5):D=Reg Reject+back-off;E=AMF NSSAI / SMF APN 限流 + 比例条 + 算法。
  - frontend-show:在 DigitalTwin 拓扑上渲染(其 showCallouts=true)。
  - frontend-flow:在 PhasePopup 内渲染 HTML 卡(其 showCallouts=false,单弹窗模式)。

## frontend-flow 额外
- `llm.ts`:phase4 D/E=algo(UFDR 溯源)、phase5 D/E=rule(流控策略)、phase7 D/E=llm(故障报告总结)。
- `AgentLoop` 3 条回环标签通用化(覆盖"换策略/补采数据"),兼容 A–E。

## 落地顺序
types/real → constructed/scenarios → director/types → DigitalTwin 弹窗 → frontend-flow llm/PhasePopup/AgentLoop → 文档。
每步两端 tsc 通过。

## 验证
两前端 `npm run build` 通过;`npm run dev` 切换 D/E 看 AMF/SMF CPU 过载 → UFDR 溯源弹窗 →
流控策略弹窗(D:Reg Reject+back-off;E:NSSAI+APN 限流+比例)→ 收敛恢复 → 评估沉淀。
