# frontend-show 优化总结:界面打磨 + 四场景重做(UDM / 用户追踪)

> 状态:**已实现**。日期:2026-07-03。设计与决策见 `docs/plans/frontend-show-demo-polish.md`。
> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(415 模块) · node 实跑场景构建器通过 · dev 服务 http://localhost:5174 HTTP 200。

## 背景与目标

按用户两大类共 8 项需求,打磨 `frontend-show` DEMO 的可读性,并把场景从 3 个重排为 4 个:新增 **A=UDM 确定性工作流** 与 **D=用户追踪** 两条故事线,B/C 保持真实数据并补全 CHR/群体异常展示。

## 按需求落地

### 一、界面优化

| # | 需求 | 落地 |
|---|---|---|
| 1 | 总 UE → 万单位 | `DigitalTwin` UE 簇标签:`UE × 85` → **「在网用户 12.8万」**(+ `TOTAL UE · 128,000`)。注:`GenerationPanel` 的「UE 数」是单用例仿真样本(40–90),非全网总数,保留原值。 |
| 2 | CHR 弹窗放大 | `ChrCallout` 重写:宽 180→**286**,字号 7.5→**10–16**,加标题条 + 强发光,并支持 `related` 伴随原因值列表。 |
| 3 | 介绍/对比放大增亮 | `ScenarioTags`:objective 10.5→**13.5(明亮 #eaf4ff)**、intro 9.5→11.5 显 2 行;`ComparisonPanel`:verdict 11.5→**14**、detail 9→**11**、标题/箭头标签同步放大。 |
| 4 | 主备中文 | 节点角标 `M/S` → **「主/备」**,角标放大(r=5→8)、主用金底深字、备用灰底亮字。 |
| 5 | 过程标算法 | `StoryState.algorithms` + `director.algorithmsFor(s, phase)`;`App.tsx` 在孪生左上叠加随相位高亮的徽标条。 |

### 二、场景优化(`data/scenarios.ts` + `constructed.ts`)

| 场景 | 数据来源 | 故障根因 | 路由 | 看点 |
|---|---|---|---|---|
| **A** UDM 确定性工作流 | 构造(case_003 拓扑 + 合成) | UDM_1 | WORKFLOW 0.74 | 多网元异常表象(Nudm 向 SMF 传播)→ 故障传播原则 + 故障聚合原则秒级收敛 UDM_1;算法链含「故障传播原则/故障聚合原则/根因定位」 |
| **B** gNB_1 CHR 用户级 | 真实 case_101 | gNB_1 | EXPLORATION | CHR 弹窗主因「无线资源不足 5GMM#22」+ **伴随两类终端侧干扰原因**(鉴权失败/协议不兼容,已剥离) |
| **C** gNB_2 CHR 聚类 | 真实 case_9001 | gNB_2 | EXPLORATION | CHR 弹窗主因「接入受限(终端群体共因)」+ **3 个伴随相关原因值**(聚类);外加 AMF_1 误报拦截标记 |
| **D** 用户追踪(新增) | 构造(case_101 拓扑 + 合成) | 空(用户侧) | EXPLORATION 0.38 | KPI/CHR 仅模糊信号(网元全绿)→ **用户分群追踪**发现物联终端群体 38% 失败 → 群体异常;userFault={gNB_2, 1280 UE} |

## 关键设计决策

- **A/D 构造、B/C 真实**:真实管线**无可观测 UDM 用例**——`case_102` 根因 UDM_2 为 standby,在 `data.csv` 出现 0 次、故障窗 SR 无下跌,KPI 层不可观测。故 A/D 取真实拓扑文本 + 合成遥测 + 手写推理链;B/C 保持真实数据,chrInsight/falseAlarm 通过扩展叙事层注入。
- **图感知 KPI 合成**:新增 `buildKpiFor(graph, fault, {propagate})`(A 用,含邻域传播)与 `buildMildOverallKpi`(D 用,仅 overall 微跌、网元全绿)。
- **避开 GUIDED**:A 用 WORKFLOW(确定性、不走 LLM);B/C/D 用 EXPLORATION——规避 GUIDED 路由 LLM loop 不稳定(既有记忆)。
- **算法标注**:相位 4 按场景给算法链,其余相位给通用算法;徽标条用当前相位色高亮。
- **用户级/自治走叙事层**:`ScenarioNarrative` 扩 `chrInsight/falseAlarm/userFault/skillEvolution`,`buildRealScenario` 与 `buildConstructedScenario` 都透传。

## 改动文件清单

**新增**
- `frontend-show/src/data/constructed.ts` — 构造式场景(TOPO_A/TOPO_D 拓扑文本 + SPEC_A/SPEC_D + `buildConstructedScenario`)。

**改动**
- `frontend-show/src/data/kpi.ts` — 新增 `buildKpiFor`(图感知 + 邻域传播)、`buildMildOverallKpi`(仅总体微跌)。
- `frontend-show/src/data/types.ts` — `ChrInsight` 加可选 `related: {code, cn}[]`。
- `frontend-show/src/data/real.ts` — `ScenarioNarrative` 扩四字段并透传;补类型 import。
- `frontend-show/src/data/scenarios.ts` — 重写为四场景(A/D 构造、B/C 真实),NARRATIVES 含完整文案与用户级数据。
- `frontend-show/src/story/types.ts` — `StoryState` 加 `algorithms`。
- `frontend-show/src/story/director.ts` — `algorithmsFor` + ALGO_BY_PHASE/ALGO_REASON 映射;SCENARIO_SUB 改写 A(UDM)并新增 D。
- `frontend-show/src/App.tsx` — 孪生左上叠加算法徽标条。
- `frontend-show/src/components/DigitalTwin/DigitalTwin.tsx` — 总 UE 万单位、CHR 弹窗放大(含 related)、主/备中文角标。
- `frontend-show/src/components/Twin/ScenarioTags.tsx` — objective/intro 字体放大增亮。
- `frontend-show/src/components/Twin/ComparisonPanel.tsx` — verdict/detail/标题字体放大增亮。

## 校验结果

- `tsc --noEmit`:0 错。
- `vite build`:成功,415 模块,831ms。
- **node 实跑场景构建器**(esbuild 打包后执行,覆盖 build 不触发的模块顶层运行时):

| 场景 | NEs | 根因 | 路由 | 关键不变式 |
|---|---|---|---|---|
| A | 45 | UDM_1 | workflow 0.74 | UDM_1 故障窗 SR=**0.9295**(变红)✓ |
| B | 21 | gNB_1 | exploration | chrInsight 已注入 ✓ |
| C | 21 | gNB_2 | exploration | chrInsight + falseAlarm(AMF_1)✓ |
| D | 21 | 空 | exploration 0.38 | 网元全绿(**0.9976**)· overall 微跌(0.986)· userFault ✓ |

四场景全部无加载异常,KPI 行为符合设计。

## 目视确认清单(自动化测不到动画/排版)

`cd frontend-show && npm run dev` → http://localhost:5174,逐场景核对:
1. UE 簇标签显示「在网用户 12.8万」;节点角标为中文「主/备」。
2. 孪生左上「算法徽标条」随相位变化(相位4 按场景:UDM→故障传播/聚合;D→用户分群追踪)。
3. 场景介绍(objective 明亮大字)+ 下方对比区(verdict 大字)清晰可读。
4. **A**:UDM_1 变红、SMF 邻域轻度劣化;推理链出现「故障传播原则/故障聚合原则」;WORKFLOW 路由。
5. **B**:phase4+ gNB_1 旁 CHR 弹窗(放大版,含伴随终端干扰原因)。
6. **C**:gNB_2 CHR 弹窗(主因 + 3 伴随原因值);AMF_1 误报标记 phase3 被划掉。
7. **D**:网络全程绿色、gNB_2 琥珀「1280 UE 群体异常」标记;KPI 面板 overall 微跌;推理链含「用户分群追踪」。

> 说明:本次**未做浏览器视觉确认**(本环境无浏览器工具)。上面 1–7 建议人工过一遍。

## 二轮打磨:可读性 / 视觉(2026-07-03,6 项)

> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(415 模块) · dev 服务 http://localhost:5174 HTTP 200。

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 场景 A 黄色线多、扎眼 | `DigitalTwin` **边线密度自适应**:`flowEdges>60` 的场景(A=168 条)整体调浅调细——健康边 opacity 0.5→0.22、宽度减半、底色透明度↓;**劣化(黄)边** opacity 0.95→0.6、弱化发光。B/C/D(27 条)阈值不触发,保持原样。 |
| 2 | 「场景」字太小偏暗 | `ScenarioTags`「场景」标签:fontSize 9→**12.5**、color `#5f6f87`→**`#cde7ff`**、加粗 800。 |
| 3 | 场景下方说明显示不全 | 去掉 intro 的 `WebkitLineClamp: 2` 截断,整段简介**完整展示**。 |
| 4 | 右侧大模型思考太多 | `ReasoningTrace`:**隐藏 args**;非当前步折叠为 **1 行摘要**(无结果块、卡片 padding 收紧);仅当前步显示完整文本+结果;步骤间距 7→5。A/B/C/D 同效。 |
| 5 | 「在网用户」被拓扑遮挡 | `DigitalTwin` UeCluster 标签改**两行堆叠**(「在网用户」/「12.8万」)并左移到 `x=4`,宽度收窄到 ~60px,避开 x=92 的 gNB 列。 |
| 6 | 阈值不该写死具体值 | 用户可见的「0.995」全部去除:算法徽标→「阈值检测」、`KpiPanel`→「动态阈值」+ 阈值线标「阈值」、`director` 副线→「跌破阈值」、A/D 推理 args/result 去 0.995、LIVE 同步。内部阈值常量保留(仅画阈值线位置用,不显示数字)。 |

**二轮改动文件**:`DigitalTwin.tsx`(密度自适应边线 + 在网用户左移)、`ScenarioTags.tsx`(场景字 + intro 完整)、`ReasoningTrace.tsx`(简化)、`KpiPanel.tsx`/`director.ts`/`constructed.ts`/`live.ts`(阈值去数值 + 推理文案精简)。

> 二轮同样**未做浏览器视觉确认**。建议人工复核:场景 A 边线不再扎眼、中列「场景」字与简介完整、右侧推理链清爽、左下「在网用户」不再被遮挡。

## 三轮打磨:可读性 / 命名 / 弹窗(2026-07-03,6 项)

> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(415 模块)。

| # | 反馈 | 落地 |
|---|---|---|
| 1 | 算法徽标挡住上方文字 | `App.tsx` 算法徽标条从 `top:8` 改到 **`bottom:6` 居中**(拓扑框最下方),不再遮挡。 |
| 2 | 阈值 → 动态阈值 | `KpiPanel` 图表阈值线标签「阈值」→「动态阈值」。 |
| 3 | 不要叫指挥中心,叫平台 | `index.html` 浏览器标题、`README.md`、`App.tsx`/`theme.ts` 注释的「指挥中心」→「平台」。 |
| 4 | 右侧推理字符多且看不懂 | `ReasoningTrace`:去掉 `tool()` 函数名徽标,类型标签改通俗(思考→分析、工具调用→探测);`real.ts` 给 B/C **重写为简洁中文推理链**(替换原英文术语 "Exploration fused… posterior=…");`constructed.ts` A/D 推理改通俗短句、各 4 步。 |
| 5 | 弹窗具体内容字体太小 | `ChrCallout` 字号整体放大:主因 16→17、原因码 11.5→12.5、**伴随原因值 10.5→13**、**说明 10→12.5**、标签 9.5→11.5;弹窗 286→314 宽并重算几何。 |
| 6 | 整体文字简化 | `scenarios.ts` 四场景 intro/objective/tagline/对比 detail/chrInsight.detail 全部缩短为短句。 |

**三轮改动文件**:`App.tsx`、`index.html`、`README.md`、`theme.ts`(注释)、`KpiPanel.tsx`、`ReasoningTrace.tsx`、`DigitalTwin.tsx`(ChrCallout 放大)、`real.ts`(B/C 中文推理)、`constructed.ts`(A/D 简化)、`scenarios.ts`(文案精简)。

> 过程小插曲:三轮中 ChrCallout 的一次整段重写触发 TSX 解析报错(疑似 `·`/tspan 多行子节点边角问题),已回退为「在已验证结构上做最小字号改动」解决;tsc/build 均通过。

## 四轮打磨:KPI 波动 / 算法改名 / A 均质化+主备切换 / B 改 SMF(2026-07-03)

> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(415 模块) · node 实跑四场景通过。

**界面**
1. **KPI 曲线加波动 + 各网元差异**:kpi.ts 新增 `healthySeries`(每条序列独立基线 0.997~0.9995 + 共模慢漂移 sin + 抖动),`buildKpi`/`buildKpiFor`/`buildMildOverallKpi` 统一改用。overall 不再是一条直线,各 NE sparkline 基线互不相同(均 ≥0.995 不误报)。
2. **去掉「---体现网络自治/用户级韧性」**:三轮已从 intro 移除;本轮确认四场景 intro/objective 均无此尾缀。
3. **EWMA / 阈值检测 → iFusion 融合异常检测**:`director.ALGO_BY_PHASE[2]` 改为单个「iFusion 融合异常检测」徽标;`ALGO_REASON` 各场景首项统一为 iFusion。

**场景 A(UDM,构造)**
- **拓扑统一**:TOPO_A(原 case_003,45 NE)删除,A/B/D 共用 `COMMON_TOPO`(case_101,21 NE),与真实场景 C 同构。
- **对比区改误报**:`comparison.naive.kind` miss→**falsealarm**(「易误报 SMF 为根因」)。
- **推理改均质化对比 + 故障聚合**:均质化对比排除 SMF 共性异常(多 SMF 都出问题)→ 故障聚合定位 UDM_1(原"故障传播原则"作废)。
- **恢复改主备切换**:UDM 分支 = 容量核查(备 UDM)→ 隔离 UDM_1(主)→ 流量切换至 UDM_2(备)。
- 算法链:iFusion 融合异常检测 · 均质化对比 · 故障聚合 · 根因定位。

**场景 B(改 SMF,构造)**
- 由真实 gNB_1(case_101)改为**构造式 SMF_1**:`SPEC_B`(SMF_1,lossRate 0.03 网络微损)。
- 叙事按用户复述:网络异常(SMF_1)+ 少量终端异常 → 多维数据校验 → CHR 用户级异常(弹窗:主因 5GSM:37 PDU 会话建立失败 + 终端干扰 5GMM:23/24)→ 排除终端原因 → 识别网络根因 SMF_1 → 恢复。
- SCENARIOS 改用 `buildConstructedScenario("B", …, SPEC_B)`;real-cases.json 的 B(case_101 gNB)不再使用。
- 现四场景:A/B/D 构造(case_101 拓扑),C 真实(case_9001 gNB_2)。

**改动文件**:`kpi.ts`(healthySeries)、`constructed.ts`(重写:COMMON_TOPO + A 均质化 + 新增 SPEC_B)、`director.ts`(ALGO iFusion + SCENARIO_SUB A/B + recoveryActionsFor UDM 分支)、`scenarios.ts`(NARRATIVES A/B + SCENARIOS 用构造 B + 头注释)。

> iFusion 取 isolation-Fusion 之意(异常检测融合算法);若需更名告诉我。

## 五轮打磨:三场景定稿 / 路由三档 / gNB 不可隔离 / iFFusion(2026-07-03)

> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(包体 480KB→345KB,real-cases.json 不再打包)。

**需求落地**
1. **D 合入 C、删除 D**:四场景→**三场景**。C 吸收 D 的「用户分群追踪 → 物联终端群体异常」(userFault gNB_2/1280UE)与旧 C 的 chrInsight/falseAlarm(AMF_1),成为 gNB 用户侧群体异常场景。
2. **路由三档(去掉「多算法探索」)**:A=**确定性工作流** WORKFLOW(0.74)、B=**技能引导** GUIDED(0.55)、C=**自主探索** AUTONOMOUS(0.28)。置信度相应调整;EXPLORATION 路由不再被任何场景使用。
3. **B 恢复切换健康 SMF**:recoveryActionsFor 新增 SMF 分支 = 隔离 SMF_1 → **切换至健康 SMF 接管会话** → UE 重建会话。
4. **gNB 无法隔离,只能通知换路**:terminal_group 分支恢复动作改为「网络侧无法隔离 gNB · 通知受影响 UE 换路/重选」(C 场景)。
5. **iFFusion**:算法名统一为「iFFusion 融合异常检测」(双 F),director ALGO + constructed 推理链全部更名。

**三场景速查**

| 场景 | 路由 | 置信度 | 故障 | 恢复 | 看点 |
|---|---|---|---|---|---|
| A | WORKFLOW | 0.74 | UDM_1 | 容量核查→隔离主→切备 UDM | 均质化对比排除 SMF + 故障聚合定位 UDM |
| B | GUIDED | 0.55 | SMF_1 | 隔离→切健康 SMF | CHR 多维校验排除终端 → 识别网络根因 |
| C | AUTONOMOUS | 0.28 | gNB 用户侧(空) | 无法隔离·通知换路 | CHR 聚类 + 用户分群 → 物联终端群体异常 |

**改动文件**:`constructed.ts`(删 SPEC_D、新增 SPEC_C 自主;B route→guided;全 iFFusion)、`scenarios.ts`(删 D、C 合并、去 real 引用、SCENARIOS 三场景)、`director.ts`(ALGO iFFusion + 删 D;SCENARIO_SUB B引导/C自主/删D;recovery SMF 分支 + terminal_group 改通知换路)。

> 副作用:三场景全为构造式(case_101 拓扑 + 合成遥测)。`real-cases.json` / `real.ts::buildRealScenario` / `scripts/export_demo_scenarios.py` 现未被 demo 引用(留作真实管线工件,未删除;real-cases.json 不再进打包)。LIVE 模式仍走 `live.ts`,不受影响。

## 六轮打磨:恢复动作具体化 + CHR 弹窗再放大(2026-07-03)

> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过。

1. **场景 A 恢复:备 UDM 升主 + 切流量** — UDM 分支恢复动作改为:容量核查(UDM_2 备)→ 隔离 UDM_1(主)→ **UDM_2(备)升主,流量切换过去**(原"流量切换至备 UDM"改为显式升主);SCENARIO_SUB A[5] 同步。
2. **场景 B 恢复:切到 SMF_2** — SMF 分支 failover 由"切换至健康 SMF"改为**「切换至健康 SMF_2 接管会话」**(具体到 SMF_2)。
3. **CHR 弹窗再放大** — ChrCallout 字号在五轮基础上再提:主因 17→**19**、原因码 12.5→**14**、伴随原因值 13→**14.5**、说明 12.5→**14**、标签→13、标题→13.5;弹窗宽 314→**344**,行距/几何同步重算。

**改动文件**:`director.ts`(recovery UDM/SMF 分支 + SCENARIO_SUB A[5])、`DigitalTwin.tsx`(ChrCallout 字号+几何)。

## 后续
- 改动未提交(工作区 `local_dev` 分支)。确认后可提交。
- `real-cases.json` 中残留的 scenario "A"(case_003 AMF)已被构造式 A 取代、不再使用,无害但冗余;若重跑 `export_demo_scenarios.py` 会再生成,可忽略或清理。
- 可选增强:D 场景的「用户追踪」目前为自动播放叙事;若要做成可点击交互(用户主动选择分群维度),需新增交互层,本次未做。
