# frontend-flow-studio · 「静谧仪器」重设计计划

> 2026-08-17 制定。基于 `frontend-flow-demo` 完整拷贝(含工作区未提交改动)到 `frontend-flow-studio/`,
> 在**不改动任何故事引擎/数据契约/LIVE 逻辑**的前提下,对表现层做一次彻底的设计语言重构。
> 原目录 `frontend-flow-demo` 保持不动,两套前端可并存对比。

---

## 0. 背景与目标

### 0.1 问题陈述

现版 `frontend-flow-demo` 的视觉语言是「深空 HUD 指挥中心」:近黑蓝底 + 霓虹青强调 +
辉光滤镜 + 网格 + 暗角 + 扫描线 + 角标框 + 全大写等宽字 + 闪烁圆点 + emoji 图标。
这套语言在 2019-2022 年的「运维大屏 / NOC 指挥中心」语境里成立,但放在 2026 年的
展会与评审场合,会被感知为「低级、廉价、模板化」—— 它堆叠了太多廉价的多巴胺
(发光、闪烁、彩虹色),而高级感恰恰来自克制。

### 0.2 目标

1. **简约、高级**:重构为一套有编辑排印气质的精密仪器界面 —— 墨色画布、发丝线结构、
   单一强调色、衬线展示字体、等宽数据字体、编排化动效。
2. **零功能回归**:4 个 DEMO 场景(A/B/C/D)全部可运行;LIVE 模式(后端 WS 接入、
   降级回 DEMO)不回归;交互(点击圆圈推进、键盘 ←/→/Esc、播放/变速/主题切换)不回归。
3. **工程整洁**:删除从未被 import 的死代码组件;设计令牌集中管理;组件不再各自硬编码颜色。

### 0.3 非目标

- 不改 `story/`(director / useStoryClock / liveBus / useLiveClock)的任何逻辑。
- 不改 `data/`(scenarios / constructed / kpi / network / plan / real / llm / topo)的数据契约。
- 不改 `api/live.ts` 的请求协议。
- 不升级 React/Vite 版本(18 + 5 稳定可用,重设计的价值在设计与实现质量,不在框架版本号)。

---

## 1. 现状审计(要还的「视觉债」清单)

逐项列出旧版的具体问题,每项都对应后文的改造动作:

| # | 现状 | 问题 | 改造 |
|---|------|------|------|
| 1 | `--accent: #38bdf8` 霓虹青,配 `--accent-violet` 第二彩色 | 双彩色 + 高饱和 = 运维大屏底色 | 单一靛蓝强调色 `oklch(0.66 0.15 277)`,语义色仅用于数据 |
| 2 | `box-shadow: 0 0 16px var(--accent-glow)` 等 30+ 处辉光 | 辉光是「廉价发光体」的视觉信号 | 全部删除;层次由表面阶梯 + 发丝线承担(Linear 准则) |
| 3 | SVG `feGaussianBlur` glow 滤镜(AgentLoop/GuideCanvas/StepModal) | 同上,且滤镜有性能成本 | 删除滤镜;激活态用描边加重 + 填充提级表达 |
| 4 | `.hud::before/::after` 四角角标 | HUD 语境的图腾 | 删除;面板 = 圆角矩形 + 1px 发丝线 |
| 5 | 网格背景 + 径向辉光 + 暗角(app-bg 三层) | 大气污染,抢内容 | 纯色画布 + 一条极淡的顶部渐隐分隔(或什么都不加) |
| 6 | `scanline / blink / pulse-ring / spin-slow` 类动画 | 闪烁 = 廉价注意力劫持 | 保留最多一个「呼吸」动画(2.4s+ 缓慢、低幅);其余改 spring 过渡 |
| 7 | `font-family: var(--font-mono)` + `letter-spacing: 0.1em` + `text-transform: uppercase` 滥用于标签 | 全大写等宽 = 终端/HUD 腔 | 标签改 11px sans 小字距;等宽只用于**数据**(KPI/CPU/公式/id) |
| 8 | 🧠📡✅🛡📋🔧🗺🔍🎯📊👇 等 emoji 图标 | emoji 跨平台渲染不一致,廉价 | 全部替换为几何 SVG 记号或纯文字标记 |
| 9 | 字重普遍 800 | 粗黑 = 喊叫 | 标题 600/650,正文 400/450;衬线标题自带权威 |
| 10 | 边框 `rgba(56,189,248,x)` 青色调线 | 彩色线大量出现 = 花 | 发丝线一律中性 `oklch(1 0 0 / 6~14%)`,彩色线只表达数据语义 |
| 11 | 面板内边距 7-13px、信息密度过挤 | 没有留白就没有高级 | 统一 12/16/20 阶梯,卡片 16px |
| 12 | 5 种 NE 类型色 + 4 种路由色 + 8 种相位色,同屏彩色的 15+ | 彩虹 = 廉价 | 网元一律中性;相位收敛为 4 个语义色(见 §4.4);路由 3 色(绿/靛/琥珀) |
| 13 | 按钮 uppercase mono + 发光 hover | 同 2/7 | pill 分段控件(surface 提级 = 选中,Linear 定价页模式) |
| 14 | StepModal 紫框 + 大投影 + 玻璃模糊 | 玻璃拟态滥用 | surface-2 实底 + 发丝线 + 单层暗投影;模糊只留给画布浮层 |
| 15 | 死代码:DigitalTwin/SkillLibrary/Timeline/Gauge/HudFrame/Radar/InfoPanel(0 import) | 包体与维护负担 | 删除 |

---

## 2. 业界参考(2026-08 调研)

设计决策的依据,按重要度排序:

### 2.1 Linear —— 表面阶梯 + 发丝线 + 单强调色

来自 Linear 官方设计规范(DESIGN.md 全文已读)的核心准则:

- 画布 `#010102`(近纯黑、微蓝调),**四阶表面阶梯** surface-1..4 承担全部层次;
  **拒绝投影**:「Linear's depth is carried by surface ladder + hairline borders.
  The brand resists drop shadows on dark almost entirely.」
- 发丝线 1px `#23252a → #34343a → #3e3e44` 三档;
- **单一彩色强调**(薰衣草蓝 #5e6ad2)只用于品牌、焦点环、主 CTA;
  「Don't introduce a second chromatic accent」「Don't add atmospheric gradients or spotlight cards」;
- 排版:display 600 + 负字距(-3px@80px ≈ 4%),正文 400,eyebrow +0.4px 正字距;
- 4px 网格;按钮 8px 圆角;卡片 12px;**禁 pill 圆角 CTA、禁纯黑 #000、禁浅色模式营销页**;
- 动效「tightly controlled motion」。

### 2.2 Vercel/Geist —— 中性灰阶与工程克制

最高声望的 dev-tool 品牌族(Linear、Vercel、Raycast、Arc、Warp)2026 年默认深色 +
中性灰 + 精确排版。Geist 的启示:**中性色阶要够宽**(12 阶),数据 UI 才有层次可调。

### 2.3 编辑排印(Stripe Press / 高端刊物)

高级感最便宜的来源是**字体的排印学正确性**:衬线展示字体用于标题(中文=思源宋体)、
罗马/等宽用于数据、明确的大小对比与行高。2026 年衬线 display 回潮
(Playfair/Bodoni 系在 Typewolf 2026 排名居前),中文语境对应**思源宋体/Noto Serif SC**
做大号标题 —— 这是与「运维大屏」拉开距离的最强单品。

### 2.4 现代 CSS(2026 生产就绪)

- `oklch()` + `color-mix()`:感知均匀的色阶生成,主题切换只需重定义十几个基色;
- `font-variant-numeric: tabular-nums`:数据表格/KPI 数字对齐的行业标准;
- `@property` 注册自定义属性供过渡动画;
- 容器查询按面板宽度自适应(本次场景固定桌面,预留)。

### 2.5 Motion(framer-motion 11,已随包)

2026 最佳实践:spring 优先(刚度/阻尼而非时长/缓动)、`AnimatePresence` 出场动画、
`staggerChildren` 编排、`layout` 共享布局;**可访问性**:动效只做「状态变化的解释」,
不做装饰性循环。

---

## 3. 设计理念:「静谧仪器 / The Quiet Instrument」

一句话:**把界面从「指挥中心大屏」改写为「一台放在丝绒上的精密仪器」**。

四条支柱:

1. **墨色即留白**(dark canvas as whitespace)—— 近黑中性画布,内容浮在发丝线面板上,
   不靠颜色区分区域,靠「表面提级」区分。
2. **一支强调色** —— 靛蓝(`indigo ink`)只出现在:当前步骤、焦点、主交互、品牌记号。
   红/琥珀/绿是**数据的语义**,不是装饰。
3. **衬线立骨,等宽立据** —— 标题与关键结论用思源宋体(编辑气质);一切测量值
   (KPI/CPU/公式/ID/时间)用 JetBrains Mono + tabular-nums(仪器气质)。
4. **动效即解释** —— 每个动画解释一次状态变化(进入/推进/揭示),循环动画全局
   只保留一种(采集数据流的细虚线漂移),幅度小、周期长、低对比。

反模式清单(明确不做):辉光 / 扫描线 / 网格 / 暗角 / 闪烁 / 彩虹分类 / 全大写标签 /
emoji 图标 / 玻璃拟态卡片 / 第二强调色。

---

## 4. 设计令牌系统(实现 §)

### 4.1 色彩 —— OKLCH,三主题

`src/styles/tokens.css` 定义,**所有组件只引用 var()**,theme.ts 里与数据语义绑定的
常量改为引用同一组 CSS 变量(SVG 内用 `var(--xxx)` 直接取值)。

**主题一 `ink`(墨,默认)**:

```css
:root[data-theme="ink"], :root {
  /* 表面阶梯(近黑中性,微冷调) */
  --bg0:  oklch(14.5% 0.008 272);   /* 画布 #0c0d11 */
  --bg1:  oklch(17.5% 0.010 272);   /* 面板 surface-1 */
  --bg2:  oklch(20.5% 0.011 272);   /* surface-2:悬浮卡/选中 */
  --bg3:  oklch(24.0% 0.012 272);   /* surface-3:浮层 */
  --bg-inset: oklch(12.5% 0.008 272); /* 画布内凹区(拓扑底) */
  /* 发丝线三档 */
  --line:    oklch(100% 0 0 / 7%);
  --line-2:  oklch(100% 0 0 / 12%);
  --line-3:  oklch(100% 0 0 / 18%);
  /* 墨阶(文字) */
  --ink-1: oklch(96% 0.004 272);  /* 标题 */
  --ink-2: oklch(88% 0.005 272);  /* 正文 */
  --ink-3: oklch(74% 0.006 272);  /* 次要 */
  --ink-4: oklch(58% 0.006 272);  /* 辅助 */
  --ink-5: oklch(45% 0.005 272);  /* 微标 */
  /* 强调(靛蓝墨水) */
  --accent:    oklch(66% 0.150 277);  /* #7f8cf0 附近 */
  --accent-hi: oklch(74% 0.140 277);  /* hover */
  --accent-lo: oklch(55% 0.160 277);  /* 按下/深 */
  --accent-wash: oklch(66% 0.150 277 / 10%);  /* 选中底 */
  /* 语义(仅数据) */
  --ok:   oklch(72% 0.135 155);  /* 恢复/健康 */
  --warn: oklch(78% 0.130  75);  /* 检出/过载边缘 */
  --danger: oklch(66% 0.170 25); /* 故障/根因 */
  --info: oklch(70% 0.110 240);  /* 中性信息蓝(仅图表第二序列) */
}
```

**主题二 `mist`(雾)**:ink 的整体提亮版(画布 oklch 21%,表面 24→32%,线 10→20%,
墨阶全提),对应旧「暮光」的展会远观需求。

**主题三 `paper`(纸)**:暖白纸面 `oklch(97.5% 0.004 95)`,表面=白→暖灰阶梯,
墨阶反向,强调色加深 `oklch(52% 0.180 277)`。对应旧「明亮」。

### 4.2 字体

```css
--font-display: "Noto Serif SC Variable", "Noto Serif SC", "Source Han Serif SC", serif;
--font-sans: "Inter Variable", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, "Cascadia Code", Consolas, monospace;
```

三个字体全部走 `@fontsource/*` 本地打包(离线可用,CJK 按 unicode-range 分包按需加载)。
数据文本统一 `font-variant-numeric: tabular-nums`。

### 4.3 字号阶梯(桌面 1440+,14 档收敛为 8 档)

| 令牌 | 值 | 用途 |
|---|---|---|
| `--t-display` | 20px/650 · serif | 场景标题、模态标题 |
| `--t-title` | 15px/600 · serif | 面板标题、步骤标题 |
| `--t-body` | 12.5px/400 · sans | 正文说明 |
| `--t-label` | 11px/500 · sans,+0.02em | 区块标签 |
| `--t-micro` | 9.5px/500 · sans,+0.06em | 图注、图例 |
| `--t-data` | 12px/500 · mono,tabular | KPI 数值 |
| `--t-data-lg` | 22px/500 · mono,tabular | 置信度等单值 |
| `--t-data-xs` | 9.5px/400 · mono,tabular | 密集小数值 |

中文衬线标题字距 0;拉丁 eyebrow 允许 +0.06em 大写(仅限 PHASE/AGENT 一类系统记号,
一处最多一行)。

### 4.4 语义色映射(相位收敛为 4)

相位不再各配一色,改为语义轴:

| 相位 | 色 | 理由 |
|---|---|---|
| 0 稳态 / 6 恢复 / 7 评估 | `--ok`(或中性) | 健康/完成态 |
| 1 采集 / 3 匹配 / 4 推理 | `--accent` | 智能体工作 = 品牌 |
| 2 异常检测 / 5 执行干预 | `--warn` / `--danger` | 告警/干预 |

`theme.ts::PHASES` 保留结构(color 字段指向上述变量名),下游组件无需改数据流。
`NE_COLORS` 9 色删除 → 网元统一中性(墨色描边),仅状态(故障/根因/聚焦)用语义色。
`srColor()` 阈值色改为 oklch 语义色。

### 4.5 半径 / 间距 / 投影

- 半径:控件 6px,卡片 10px,浮层 12px,**无 pill**(分段控件选中态=表面提级)。
- 间距:4 的倍数;面板内边距 12/16;卡片 14;浮层 16。
- 投影:深色主题下唯一允许 `0 8px 24px oklch(0% 0 0 / 40%)` 用于真正浮起的层
  (模态、tooltip),面板**永不投影**。

### 4.6 动效令牌

```css
--ease-out: cubic-bezier(0.22, 1, 0.36, 1);
--spring: { type: "spring", stiffness: 280, damping: 32 };   /* framer-motion */
--dur-1: 140ms;  /* hover/微交互 */
--dur-2: 240ms;  /* 面板内过渡 */
--dur-3: 420ms;  /* 模态/大幅位移 */
```

循环动画全局仅保留:数据流虚线漂移(1.6-2.4s,低对比)、活动步骤的单圈细描边呼吸
(2.8s, opacity 0.35→0.7)。

---

## 5. 组件级改造清单

> 结构、props、数据流一律不动;只动视觉与动效。逐文件列改动要点。

### 5.1 `styles/global.css`(重写)

- `@import` 三字体 + tokens.css 合并;三主题变量组;基础 reset;滚动条(4px 中性);
  `.hud` 面板类 → 改名 `.panel`(保留 `.hud` 别名防漏改);`.btn` 重写为安静按钮;
  `.fpop/.step-modal` 浮层基类重写;动效 keyframes 收敛到 3 个。

### 5.2 `theme.ts`

- 删 `NE_COLORS`、`GLOW`;`STATUS` 改 CSS 变量引用(`var(--ok)` 等,SVG 可直接用);
- `PHASES` 色映射改语义 4 色(见 §4.4);`FONT` 对齐新栈;`srColor()` 改语义色;
- `ROUTE_COLORS`:workflow=ok 绿 / guided=accent / autonomous=warn 琥珀。

### 5.3 `Shell/ThemeContext.tsx`

- 主题 id 改 `ink | mist | paper`,标签「墨/雾/纸」,默认 `ink`,`THEME_BG` 同步。

### 5.4 `Shell/TopBar.tsx`

- 布局不变。标识:方形记号(细线六边形+中心点,accent 描边)+ 衬线标题
  「高稳智能体」+ 微标拉丁;中间叙事:eyebrow(相位)+ 衬线 headline;
- 控件:播放(几何 ▶/❚❚ SVG)、速度分段(0.5/1/2)、DEMO/LIVE 分段、主题三分段
  (墨/雾/纸),全部 pill 组内表面提级式选中;pillars 徽标改两枚安静描边章
  (点亮=语义色描边,不发光)。

### 5.5 `SolutionFlow/*`(左侧方案列)

- `SolutionFlow`:去 borderTop 青线与内阴影;标题「方案流程」serif;BrainBox 改
  「智能体」大卡(surface-1,工作时描边转 accent,无光)。
- `NetworkStrip`:网元 chip 全中性(墨描边小胶囊);gNB 塔图标重画细线版;箭头细线化。
- `Bridge`:双向箭头重画(细杆+小三角),上行=accent、下行=info,标签 mono 微字。
- `AgentLoop`(SVG,改动最大):删 glow 滤镜与 alert-ring;Agent 盒 = 圆角矩形 +
  发丝线,激活提级 surface;步骤节点 = 细线圆角框,激活 = accent 描边 + wash 填充,
  完成 = ok 描边;回环线 = 语义色细虚线(粒子保留但去光晕);图标 emoji → 几何记号
  (A1=同心圆采集、A2=脑回线、A3=对勾圆)。

### 5.6 `Guide/*`(右侧引导舞台)

- `GuidedStage`:场景条改「分段标签」(serif 字母 + sans 短名,选中=表面提级 +
  accent 下划短线);「重新开始」改安静描边按钮。
- `GuideCanvas`(视觉核心):
  - DC 框:点线改极淡实线圆角框 + 左上 serif 标注;
  - 节点:统一中性圆(发丝线),状态语义:故障=danger 描边+呼吸单环(去 spin 双环)、
    根因=danger 虚线外环(静止)、隔离=中性虚线方框、过载=danger 角标文字;
    主备徽章改 3px 小点(master=accent / standby=ink-5);
  - 边:中性 hairline;劣化=danger/warn;采集线=accent 细虚线漂移;下发线=accent
    实线 + 端点箭头(粒子小、无光);
  - 顶带 7 圆圈:细描边圆 + mono 数字;完成=ok 细勾;当前=accent 填充;引导 👇 →
    细线下箭头 SVG 呼吸;起步提示改一行 ink-4 微字;
  - 悬停 tooltip:bg3 实底 + 发丝线 + serif 标题。
- `StepModal`:bg2 实底、line-2 边、12px 圆角、单层投影;头部 = mono 步号圆 +
  eyebrow + serif 标题;关闭 = 细线 ×;连接线改 accent 细虚线;入场 spring + 轻微
  上移淡入(替代 fpop-in)。
- `PhasePanels`(内容图表):全部卡片 = bg1 + line 边;小标题 = serif + 语义色左标线
  (替代 emoji+mono 大写);曲线图:1.25px 线宽、去发光、阈值线=danger 虚线、
  图例 = 色点 + sans 微字;Donut/Bar/CpuBar 配色走语义令牌;推理链步 = 左侧细竖线 +
  mono 步号,结论步 = danger 左标线,去彩色底。
- `KpiStrip`:stat 卡 = 无边框列,顶部 hairline 分隔;标签 micro sans;数值 mono
  tabular;sparkline 1.25px + 端点点;游标 = ink-3 细线。

### 5.7 `StepAxis`(底部步骤长轴)

- 由「彩色格子墙」改为**轨道式进度**:一条 2px hairline 轨道 + 各步刻度点
  (完成=ok 实心 / 当前=accent 环 / 未来=空心),当前步上方浮 serif 步名 + 结论
  微字,轮次边界 = 细虚线 + ↻ 记号;播放头 = 1.5px accent 垂线 + 顶端小三角。
- 保留按段时长比例的格宽分配与 rAF 直驱播放头(逻辑不动)。

### 5.8 `App.tsx`

- 容器 padding/gap 微调(12),`liveError` toast 改安静样式。逻辑零改动。

### 5.9 删除清单

`components/DigitalTwin/`、`components/SkillLibrary/`、`components/Timeline/`、
`components/shared/`(Gauge/HudFrame/Radar)、`Guide/InfoPanel.tsx` —— 均为 0 import
死代码(已删)。

---

## 6. 实施顺序

1. **P1 令牌与全局**:`styles/global.css` 重写 + `theme.ts` + `ThemeContext` + `main.tsx`
   字体引入 + `index.html`。构建通过,页面即换底色(粗看已去 HUD)。
2. **P2 骨架组件**:TopBar / App 容器 / SolutionFlow 外壳。
3. **P3 左列**:NetworkStrip / Bridge / AgentLoop(SVG 重画)。
4. **P4 右列**:GuidedStage 场景条 / GuideCanvas(节点+边+圆圈+顶带)/ KpiStrip。
5. **P5 浮层**:StepModal / PhasePanels 全部图表卡。
6. **P6 底轴**:StepAxis 轨道化。
7. **P7 清理验证**:删死代码(已完成)、`tsc --noEmit && vite build`、四场景逐相位
   走查(截图)、LIVE 降级路径走查、三主题走查。

## 7. 验收标准

- [ ] `npm run build`(tsc + vite)零错误;
- [ ] DEMO 4 场景 A/B/C/D:自动推进、点击圆圈弹窗、8/12/14 步长轴、B/C/D 两轮回路
  与 R2 标记、C 误报拦截、D 三层策略两轮数值 —— 与旧版行为一致;
- [ ] 后端不在时:capabilities 失败静默回落 DEMO;LIVE 按钮禁用提示;
- [ ] 三主题 ink/mist/paper 切换即时生效,刷新回 ink;
- [ ] 全局 grep 无 `glow` 滤镜、无 `#38bdf8` 残留、无 emoji 图标残留;
- [ ] 视觉评审:任意截图在 3 秒内可读清「当前步骤 + 当前 KPI + 根因结论」三层信息。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| SVG 内 `var(--x)` 在个别属性(如 stroke 动画)不生效 | stroke/fill 均为可继承 CSS 属性,实测支持;不行处用 `currentColor` 中转 |
| 衬线中文大字号在小屏发虚 | display 只用于 ≥15px;mist/paper 主题字重 +50 |
| 字体包体 | CJK 按 unicode-range 分包,首屏仅加载用到的子集(~100-300KB);Inter/JBM ≤100KB |
| 删除 NE_COLORS 后拓扑失去类型辨识 | 列式布局本身承载类型分组;类型标签文字保留 |
| 旧 `.hud` 类残留引用 | 全局替换为 `.panel`,grep 验证 |
