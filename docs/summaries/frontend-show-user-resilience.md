# frontend-show 优化总结:用户级韧性 × 网络自治 + 能力沉淀

> 状态:**已实现**,分支 `feat/show-user-resilience`(未提交,待用户确认)。
> 日期:2026-06-28。设计与决策详见 `docs/plans/frontend-show-user-resilience.md`。
> 自动化校验:`tsc --noEmit` 通过 · `vite build` 通过(412 模块) · dev 服务 5174 正常启动。

## 背景与目标

`frontend-show`(展会大屏数字孪生指挥中心)原偏网络视角、炫酷但难懂、看不到能力沉淀。本次按用户四项建议 + 双主题强化重做 DEMO,新增三个递进场景,体现「用户级韧性」「网络自治」「能力沉淀」。

## 按需求落地

### ① 场景标签上移 + 简介(建议1)
新增 `components/Twin/ScenarioTags.tsx`(中列顶部):点击切换场景,常驻显示当前场景「目标 + 简介」。TopBar 原场景按钮移除。

### ② 拓扑下方对比区(建议2)
新增 `components/Twin/ComparisonPanel.tsx`(中列底部):左「仅网络聚合KPI」(漏判/误报)→ 右「多维探索后」(精准命中),中间探索箭头随相位揭示。

### ③ 步骤↔拓扑联动(建议3)
- `ReasoningTrace`:执行中(最后一步)标题放大 + 「▶ 执行中」徽标。
- `DigitalTwin`:对当前步骤高亮 NE 加「▶ 当前排查」脉冲标记。

### ④ 三个新 Demo 场景(完全替换 A/B/C,`data/scenarios.ts`)

| id | 场景 | 路由 | 看点 |
|---|---|---|---|
| **A** | 网络 AMF 异常·确定性自愈 | WORKFLOW | 工作流秒级直达 AMF_3,网络自治;**无**能力沉淀(对照) |
| **B** | 网络微损·多维校验保用户 | GUIDED | 拓扑**CHR 原因值弹窗**(5xx·资源不足)+ 排除终端 → 锁定网络根因 SMF_1 |
| **C** | 网络正常·终端群体误报拦截 | EXPLORATION | 网络全绿、gNB_2 琥珀群体标记;AMF 误报闪现 → 置信度**拦截划掉** → 识别用户侧 → 网络主动通知重选路;**沉淀新 Skill** |

三场景分别落在置信度路由三档,串成「确定性自愈 → 多维校验保用户 → 误报拦截自学习」递进故事。

### 双主题(用户级韧性 × 网络自治)
- TopBar 两条徽标按场景 `pillars` 点亮(A:自治;B/C:用户级+自治)。
- 用户级信号(CHR、UE 群体)进入孪生;网络自治体现在确定性自愈、主动服务用户、自学习。

### 能力沉淀(痛点3)
- `EvaluationPanel` phase7 新增「能力沉淀」区块:洞察 → NEW/UPDATE Skill → 前/后 → 下次命中率↑。
- `Brain` 底部新增**常驻技能库** `SkillLibrary`,随循环累计复用,C 场景点亮「新沉淀」。

## 附带优化(用户委托「其他办法」)
- **场景化解说副线**:`director.SCENARIO_SUB` 各相位给出「此刻在干什么」(如「置信度 0.42·信号模糊·拦截快速归因·触发多维探索」)。
- C 场景恢复以「**自治动作**」呈现(通知 UE 重选/引导邻区/用户侧恢复),网络零隔离。
- 孪生实时读数在 C 场景改显「用户级异常·N UE」。

## 改动文件清单

**新增**
- `frontend-show/src/components/Twin/ScenarioTags.tsx`
- `frontend-show/src/components/Twin/ComparisonPanel.tsx`
- `frontend-show/src/components/Brain/SkillLibrary.tsx`

**改动**
- `frontend-show/src/data/types.ts` — `Scenario` 新增可选字段(intro/objective/pillars/comparison/chrInsight/falseAlarm/userFault/skillEvolution)。
- `frontend-show/src/data/scenarios.ts` — 重写 A/B/C 三新场景。
- `frontend-show/src/story/types.ts` / `director.ts` — `StoryState` 扩展 + `direct()` 派生(currentStep/comparisonReveal/chrPopup/falseAlarm/userLevel/skillReveal)+ 场景化副线 + C 场景恢复分支。
- `frontend-show/src/components/DigitalTwin/DigitalTwin.tsx` — 用户级 UE/CHR 弹窗/误报拦截/群体异常/当前排查标记。
- `frontend-show/src/components/panels/ReasoningTrace.tsx` — 执行中步骤放大 + 徽标。
- `frontend-show/src/components/panels/EvaluationPanel.tsx` — 能力沉淀区块。
- `frontend-show/src/components/Shell/TopBar.tsx` — 移除场景按钮、加双主题徽标。
- `frontend-show/src/components/Brain/Brain.tsx` — 接入 SkillLibrary。
- `frontend-show/src/App.tsx` — 中列三段重构 + 各组件接线。

## LIVE 模式兼容
新字段全可选,`buildLiveScenario` 无需改动即编译通过;LIVE 下 ScenarioTags/对比区不渲染、孪生用户级&误报叠加静默,中列退回单孪生 + 真实用例选择器。

## 目视确认清单(自动化测不到动画)
`cd frontend-show && npm run dev` → http://localhost:5174,逐场景核对:
1. 顶栏双主题徽标随场景点亮。
2. A:工作流秒级直达 AMF_3;评估无能力沉淀(对照)。
3. B:phase4 拓扑出现 CHR 原因值弹窗;对比区左「终端噪声干扰」→右「锁定网络根因」。
4. C:phase2-3 AMF 误报闪现、phase3 被划掉;gNB_2 琥珀群体标记、网络保持绿色;recovery=通知用户重选路;phase7 技能库新增 skill + 下次命中率↑。
5. 推理执行中步骤与拓扑「当前排查」联动。

## 后续
- 改动未提交,待用户确认后可提交到 `feat/show-user-resilience` 并按需合回/推送。
- 不在范围:后端 `api/`/`agents/`/`simulator/`、管理后台 `frontend/`、LIVE 新字段自动推断。
