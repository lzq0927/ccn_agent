# frontend-show 优化:用户级韧性 × 网络自治 + 能力沉淀

> 状态:**已实现**(分支 `feat/show-user-resilience`,未提交)。实现总结见 `docs/summaries/frontend-show-user-resilience.md`。
> 日期:2026-06-28。

## Context(为什么做)

`frontend-show`(展会大屏数字孪生指挥中心)目前三大痛点:
1. **视角偏网络**:几乎全是网络侧 KPI/拓扑,**用户视角**缺位;「用户级韧性」「网络自治」两大卖点看不出来。
2. **炫酷但看不懂**:动画很满,但观者不知道每一步在干什么。
3. **看不到能力沉淀**:Agent 探索完之后,如何把经验固化成 Skill、让「下一次准确识别」——这条学习闭环不可见。

本次按用户四项明确建议 + 完整双主题强化重做 DEMO。**DEMO 模式**为确定性合成叙事(与现有「确定性脚本合成恢复动作」一致,见 `frontend-show/README.md` L64-66),不伪造后端;**LIVE 模式**保持兼容(新增字段全部可选)。

已确认决策:① 用三个新场景**完全替换** A/B/C;② 能力沉淀 = phase7 评估面板新增区块 + **常驻技能库**;③ 本轮做完整四项 + 双主题强化。

---

## 1. 三个新 Demo 场景(替换 A/B/C,`data/scenarios.ts`)

按用户给的编号 1/2/3 改写,分别落在置信度路由的三个档上,串成「确定性自愈 → 多维校验保用户 → 误报拦截自学习」的递进故事:

| id | 场景 | 真相 | 路由 | 双主题 | 关键新数据 |
|----|------|------|------|--------|-----------|
| **A** | 网络中 AMF 异常·确定性工作流解决 | `AMF_3` single_ne 链路故障 | WORKFLOW(>0.7)·SUCCESS | 自治 | 轻量 comparison(工作流直达根因);**无** skillEvolution(对照:已够准,无需学习) |
| **B** | 网络异常+少量终端异常·多维校验发现**用户级 CHR** | `SMF_1→UPF` 链路微劣化,叠加终端噪声 | GUIDED·SUCCESS | 用户级+自治 | `chrInsight`(拓扑弹窗:CHR 5xx 原因值,如 `PDU Establishment Reject / cause=insufficient_resource`);comparison(naive 受终端噪声干扰→探索后锁定网络根因);skillEvolution=UPDATE |
| **C** | 网络正常+终端群体异常·**误报拦截** | **无网络故障**;`gNB_2` 范围终端群体异常 | 信心拦截→EXPLORATION·SUCCESS | 用户级+自治 | `falseAlarm`(naive 误报 AMF_3);`userFault`(gNB_2 群体);comparison(误报网络→识别为 gNB 终端,网络无责);recovery=「网络主动通知用户重选路」;skillEvolution=**NEW** |

- C 是高潮场景:网络 NE 全程**保持绿色**(健康),只有 `gNB_2` 带「用户群体异常」标记——直观传达「网络正常、问题在用户侧、网络主动服务」。
- 数值仍忠实系统区间(基线 0.997~0.999、故障窗 0.85~0.97、阈值 0.995、置信度加权公式),复用现有 `buildKpi`/`affectedEntities`。

---

## 2. 数据模型扩展(`data/types.ts`)

`Scenario` 追加**可选**字段(LIVE 不填则组件降级,见 §7):

```ts
intro: string;                         // 场景简介(标签悬停/选中弹窗)
objective: string;                     // 一句话目标(始终可见的上下文)
pillars: { userLevel: boolean; autonomy: boolean };   // 双主题点亮

comparison?: {                         // 拓扑下对比区(建议2)
  naive:    { title: string; verdict: string; detail: string; kind: "miss" | "falsealarm" };
  explored: { title: string; verdict: string; detail: string };
};
chrInsight?: { nes: string[]; causeCode: string; causeCn: string; detail: string };  // 拓扑弹窗(场景B)
falseAlarm?: { naiveNe: string; naiveCn: string; reason: string };                   // 误报拦截(场景C)
userFault?:  { gnbs: string[]; affectedUe: number; kind: string };                    // 用户侧异常(场景C)
skillEvolution?: {                                                    // 能力沉淀(建议3/痛点3)
  kind: "NEW" | "UPDATE"; skillId: string; skillCn: string;
  insight: string; before?: string; after: string; nextHitRate: number;
};
```

`ReasonStep.highlight` 已支持 `nes/links`,够用;CHR 弹窗/误报由 `StoryState` 派生(见 §3),不改 step 结构。

---

## 3. 导演派生(`story/types.ts` + `story/director.ts`)

`direct()` 增加(纯函数,随 `t` 确定性派生):

- `currentStep: ReasonStep | null` —— 推理阶段最后揭示的那一步(供大标题 + 拓扑「当前排查」标记)。
- `comparisonReveal: 0..1` —— phase<4→0;phase4 `easeOut(progress)`;phase≥5→1。
- `chrPopup` —— `scenario.chrInsight` 且 phase∈[4,6] 时出现(B 场景)。
- `falseAlarmActive` / `falseAlarmIntercepted` —— `scenario.falseAlarm` 且 phase∈[2,4] 可见,phase≥3 被置信度拦截/划掉。
- `userLevel` —— 由 `userFault` 派生受影响 gNB 与 UE 数;C 场景网络 NE 不进入 `affectedNe`(保持绿色)。
- `skillReveal: 0..1` —— phase7 `easeOut`。
- 调整 `affectedNe` 计算:C 场景不把 gNB/网络 NE 标红,改走 `userLevel` 通道。
- `recoveryActionsFor` 增加 `terminal_group`(C)分支:『通知受影响 UE 重选 / 切换邻区』(网络主动服务用户),并按实际故障 NE 动态生成 `single_ne` 恢复动作。

`StoryState` 同步加以上字段。

---

## 4. 中列布局重构(`App.tsx`)

中列由「单 twin」改为三段(纵向):

```
┌─ ScenarioTags(标签条 + 简介)            ─ ~64px
├─ DigitalTwin(用户级增强)                ─ flex(主力)
└─ ComparisonPanel(before/after 对比区)    ─ ~110px
```

- twin SVG 已用 `viewBox 1120×660` + `preserveAspectRatio meet`,缩放自适应;大屏(展会)空间充足。
- DEMO 模式渲染 ScenarioTags + ComparisonPanel;LIVE 模式这两块降级(见 §7),中列退回单 twin + 现有用例选择器。

---

## 5. 新增/改动组件

| 文件 | 改动 |
|------|------|
| **新增** `components/Twin/ScenarioTags.tsx` | 三个场景标签(建议1),点击切换;常驻显示 `objective`+`intro`。替换 TopBar 里的场景按钮。 |
| **新增** `components/Twin/ComparisonPanel.tsx` | 左「仅网络KPI视角(naive)」右「多维探索后(explored)」对比(建议2),按 `comparisonReveal` 动画揭示;复用 `scenario.comparison`。 |
| **新增** `components/Brain/SkillLibrary.tsx` | 常驻技能库(痛点3):Brain 底部条,展示已沉淀 Skill,随循环累积;C 场景点亮「新沉淀」。 |
| **改** `DigitalTwin.tsx` | ① 用户级 UE 接入线按受影响 gNB 染琥珀;② **CHR 弹窗**(B):受影响 NE 旁 callout 显示原因值+说明;③ **误报拦截**(C):phase2-4 在 AMF_3 闪现「误报嫌疑」→phase3「✗ 已拦截」+划线;④ **用户群体异常标记**(C):gNB_2 琥珀色环+UE 数,网络 NE 保持绿;⑤ **当前排查标记**(建议3):`currentStep.highlight` 的 NE 加脉冲环+「当前排查」标签。配色复用 `theme.ts` 的 `STATUS`/`NE_COLORS`/`srColor`。 |
| **改** `ReasoningTrace.tsx` | 执行中(最后一步)标题放大 + 「▶ 执行中」徽标(建议3)。 |
| **改** `EvaluationPanel.tsx` | phase7 新增「能力沉淀」区块:洞察 → skillEvolution(NEW/UPDATE + skillId)→ before/after → 「下次命中率 ↑ X%」。 |
| **改** `TopBar.tsx` | 移除场景按钮(移至 ScenarioTags);新增**双主题徽标**「用户级韧性 / 网络自治」,按 `scenario.pillars` 点亮。 |
| **改** `data/scenarios.ts` | 重写为 A/B/C 三新场景 + 填充 §2 全部新字段。 |
| **改** `story/types.ts`/`director.ts` | §3 派生字段 + 场景化动作解说副线 `SCENARIO_SUB`。 |
| `styles/global.css` | 复用既有动画(`alert-ring`/`float-up`/`blink`/`flow-dash`),无需新增。 |

---

## 6. 双主题(用户级韧性 × 网络自治)

- **TopBar 徽标**:始终展示两条,按当前场景 `pillars` 高亮(解决「两大特征看不出来」)。
- **用户级韧性**落点:孪生用户级 UE/gNB 视图(B 受影响用户/CHR、C 群体异常) + ComparisonPanel 右侧「保护用户」结论。
- **网络自治**落点:A 确定性自愈;C「网络无责却主动通知用户重选路」(recovery 动作) + 能力沉淀(自学习)。

---

## 7. LIVE 模式兼容(`data/live.ts`)

- 新字段全可选 → `buildLiveScenario()` 返回值不填这些字段即可编译通过,**不改 live.ts 逻辑**。
- ScenarioTags / ComparisonPanel / SkillLibrary / 孪生用户级&误报叠加,均用 `?.` 守卫:字段缺失时静默不渲染,中列退回单 twin;LIVE 仍走现有用例选择器与真实遥测。

---

## 8. 附带优化(用户委托「其他优化办法」)

- **场景化解说副线**:`director.SCENARIO_SUB` 按场景+相位给出「此刻在干什么」一句话(如「置信度 0.42·信号模糊·拦截快速归因·触发多维探索」),缓解「看不懂在干什么」。
- **网络自治动作账**:C 场景的「通知用户重选路」在 RecoveryPanel 以「自治动作」呈现(通知/引导/用户侧恢复),网络零隔离。
- **孪生读数场景化**:C 场景实时读数改显「用户级异常·N UE」,而非「N NE degraded」。

---

## 9. 分支

从 `local_dev` 切出特性分支 `feat/show-user-resilience`,所有改动在其上;完成后由用户决定是否合回/推送。(按规范不在默认分支直接提交。)

---

## 10. 验证

1. `cd frontend-show && npm run lint`(=`tsc --noEmit`)——类型必须过。
2. `npm run dev` → http://localhost:5174,DEMO 模式逐项核对(见实现总结的目视清单)。
3. 切 LIVE 模式(需后端 `python -m uvicorn api.app:app --port 8000`):确认降级正常。
4. `npm run build` 产出 `dist/` 无报错。

---

## 不在本次范围

- 不动后端 `api/`、`agents/`、`simulator/`(纯前端 DEMO 合成,无真实闭环依赖)。
- 不改 `frontend/`(管理后台)。
- LIVE 模式不做新字段的自动推断(真实用例无 CHR/误报语义),仅保证不崩、降级干净。
