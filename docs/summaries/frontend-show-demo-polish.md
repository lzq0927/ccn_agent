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

## 后续
- 改动未提交(工作区 `local_dev` 分支)。确认后可提交。
- `real-cases.json` 中残留的 scenario "A"(case_003 AMF)已被构造式 A 取代、不再使用,无害但冗余;若重跑 `export_demo_scenarios.py` 会再生成,可忽略或清理。
- 可选增强:D 场景的「用户追踪」目前为自动播放叙事;若要做成可点击交互(用户主动选择分群维度),需新增交互层,本次未做。
