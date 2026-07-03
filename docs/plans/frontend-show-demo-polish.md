# frontend-show 优化计划:界面打磨 + 四场景重做(UDM / 用户追踪)

> 日期:2026-07-03。落地总结见 `docs/summaries/frontend-show-demo-polish.md`。
> 范围:仅 `frontend-show/`(展会大屏 DEMO),不动后端/`frontend/`。

## 背景与目标

`frontend-show` 现有 DEMO 三场景(A=AMF、B=gNB_1、C=gNB_2)全真驱动,但展会现场反馈若干可读性与故事性问题。本次按用户两大类、共 8 项需求打磨界面并把场景重排为四场景,新增 **UDM 确定性工作流** 与 **用户追踪** 两条故事线。

## 需求(用户原始清单)

### 一、界面优化
1. 总 UE 改为「万」为单位。
2. CHR 弹窗放大(当前看不清)。
3. 中列上方场景介绍字体放大、增亮;下方对比区同样放大增亮。
4. 主备角标写中文「主/备」,不写 M/S。
5. 过程中标出所用算法(异常检测、CHR 聚类、故障聚合、根因定位 等)。

### 二、场景优化
1. **场景 A 改为 UDM 异常**:多个网元现异常表象,经确定性工作流(含故障传播原则、故障聚合原则)定位到 UDM 为根因。
2. **场景 B**:原因值写清楚,并把干扰的终端原因也写出来。
3. **场景 C**:终端原因值弹窗写出(伴随若干相关原因值,通过聚类定位为群体异常)。
4. **场景 D(新增)**:需用户追踪的案例——先由 KPI、CHR 发现初步异常但无法定根因,用户跟踪后发现某类用户异常。

## 探查结论(决定方案的关键事实)

- 真实数据映射(来自 `real-cases.json`):A=case_003(AMF_3)、B=case_101(gNB_1)、C=case_9001(gNB_2),均走 EXPLORATION、P=R=F1=1.0。
- **没有可观测的 UDM 真实用例**:`storage/cases/case_102` 根因是 UDM_2,但 UDM_2 是 **standby**,在 `data.csv` 中出现 **0 次**,故障窗内整体 SR 无任何下跌 → KPI/链路层完全不可观测,无法做视觉演示。`case_004` 是 dc 类 37 网元大故障,不干净。
- `chrInsight`/`falseAlarm`/`userFault`/`skillEvolution` 字段在 `Scenario` 类型上已存在,但真实数据场景(`buildRealScenario`)**未注入**,即这些用户级/自治特性此前在 DEMO 里是休眠的。
- `buildKpi`(合成 KPI)写死作用于内置 `DEMO_GRAPH`,非图感知;`recoveryReroute`/`affectedEntities` 的 DEMO 包装也基于内置图(本次不动,场景根因 NE 在内置图中存在,够用)。

## 设计决策

### D1:场景 A 与 D 用「构造式」,B/C 保持真实
- A、D 的故事(UDM 可视化根因 / 用户追踪)在真实管线中无对应可用例,故采用**真实拓扑文本 + 合成遥测 + 手写推理链**。
- B/C 继续走 `export_demo_scenarios.py` → `real-cases.json` → `buildRealScenario`,保持全真;其 chrInsight/falseAlarm 通过**扩展叙事层**注入。
- 取舍:真实管线纯度 vs 故事完整性。展会优先讲清故事,故 A/D 构造、B/C 真实,并明确标注。

### D2:新增图感知 KPI 合成 `buildKpiFor` / `buildMildOverallKpi`
- `buildKpiFor(graph, fault, {propagate})`:作用在任意 `NetworkGraph` 上;`propagate>0` 时让根因 NE 的邻居(共享业务链路)按比例轻度劣化,呈现 A 场景「多网元异常表象」的传播感。
- `buildMildOverallKpi(graph, start, dur, dip)`:仅 overall 微跌、网元全绿,用于 D「信号模糊、网络健康」。

### D3:用户级/自治数据走叙事层
扩展 `ScenarioNarrative`(`real.ts`)携带 `chrInsight/falseAlarm/userFault/skillEvolution`,`buildRealScenario` 与新增的 `buildConstructedScenario` 都透传到 `Scenario`。`ChrInsight` 加可选 `related`(伴随原因值),弹窗放大并渲染。

### D4:算法标注走相位派生
`StoryState` 加 `algorithms`,`director.algorithmsFor(s, phase)` 产出:相位 4 按场景给算法链(A:故障传播/聚合;B:CHR 聚类/跨层融合;C:共因/贝叶斯融合;D:用户分群追踪),其余相位给通用算法(阈值检测/EWMA-CUSUM/P-R-F1 比对…)。`App.tsx` 在孪生左上叠徽标条。

### D5:四场景路由差异化
- A:WORKFLOW(确定性、不走 LLM,conf 0.74)——避开 GUIDED LLM 不稳定问题(见既有记忆)。
- B/C:EXPLORATION(真实)。
- D:EXPLORATION(conf 0.38,信号模糊)。

## 实施步骤

1. **数据层**:`kpi.ts` 加两个合成器;`types.ts` 给 `ChrInsight` 加 `related`;`real.ts` 扩 `ScenarioNarrative` 并透传。
2. **构造式场景**:新文件 `constructed.ts`(TOPO_A=case_003、TOPO_D=case_101 拓扑文本 + SPEC_A/SPEC_D + `buildConstructedScenario`)。
3. **编排**:`scenarios.ts` 重写为四场景(A/D 构造、B/C 真实),NARRATIVES 含完整文案与 chrInsight/falseAlarm/userFault。
4. **导演**:`story/types.ts` 加 `algorithms`;`director.ts` 加 `algorithmsFor`+ALGO 映射、改写 SCENARIO_SUB(A→UDM、新增 D)。
5. **界面**:`DigitalTwin.tsx`(总UE万、CHR 弹窗放大、主/备中文)、`ScenarioTags.tsx`+`ComparisonPanel.tsx`(字体放大增亮)、`App.tsx`(算法徽标条叠加)。
6. **校验**:`tsc --noEmit` + `vite build` + node 实跑场景构建器(确认无加载异常、KPI 行为符合设计)。

## 不在范围
- 后端 `api/`/`agents/`/`simulator/`、管理后台 `frontend/`。
- LIVE 模式新字段自动推断(沿用既有:可选字段,LIVE 下用户级叠加静默)。
- 真实 UDM 用例的仿真再生(需 LLM 且 standby 不可观测,性价比低)。
