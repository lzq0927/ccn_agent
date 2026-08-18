# 高稳智能体 · 引导式演示前端 · Studio(`frontend-flow-studio`)

「静谧仪器 / The Quiet Instrument」—— `frontend-flow-demo` 的完整拷贝 + 表现层彻底重设计。
**故事引擎、场景数据、LIVE 逻辑逐行未动**;原目录保留,两套前端可并存对比。

```bash
npm install && npm run dev        # 端口 5180(0.0.0.0,同网段可访问)
npm run build                     # tsc --noEmit + vite build
node scripts/verify.mjs           # 程序化验证(需 dev server 在跑;四场景逐圆圈走查 + 字体/主题/LIVE 降级)
```

## 设计语言(与 frontend-flow-demo 的差异)

| | demo(旧) | studio(本目录) |
|---|---|---|
| 视觉 | 深空 HUD:霓虹青+辉光+网格暗角+扫描线+角标框 | **静谧仪器**:墨色画布 + 表面阶梯 + 发丝线,零辉光 |
| 强调色 | 青 + 紫双彩色 | **一支靛蓝** `#7d8af2`;红/琥珀/绿只表达数据语义 |
| 排版 | 全大写等宽标签 | **思源宋体标题 + Inter 正文 + JetBrains Mono 数据**(tabular-nums,离线打包) |
| 主题 | 深邃/暮光/明亮 | **墨 / 雾 / 纸**(OKLCH 令牌) |
| 动效 | 闪烁/旋转/辉光粒子 | spring + rise 入场;循环动画仅数据流漂移与呼吸描边 |
| 步骤轴 | 彩色格子墙 | 轨道式进度(刻度点 + 当前步浮标) |

完整设计计划:`docs/plans/frontend-flow-studio-redesign.md`;
实现方案与案例运行效果(截图):`docs/frontend-flow-studio.md`。

## 使用

- **DEMO(默认)**:场景 A/B/C/D 构造式确定性回放 —— 点圆圈推进 + 弹窗;`←/→` 步进,`Esc` 关弹窗,`↻` 重开。
- **深链**:`?scenario=D&stop=9` 直达场景 D 第 10 步(展会大屏直达)。
- **LIVE**:顶栏切 LIVE 接后端真实闭环(`uvicorn api.app:app --port 8000` + MiniMax key);
  无后端时按钮禁用、静默停留 DEMO。
- 三主题:顶栏「墨/雾/纸」;每次刷新回到墨(演示一致开场)。

## 结构

```
src/
  styles/global.css     # 设计令牌(OKLCH 三主题)+ 组件类(panel/seg/btn/tag/fpop/step-modal)
  theme.ts              # 数据语义常量(STATUS/ROUTE_COLORS/PHASES 语义四色)
  components/Shell      # TopBar + ThemeContext(ink/mist/paper)
  components/SolutionFlow  # 方案列:NetworkStrip + Bridge + AgentLoop(SVG 闭环图)
  components/Guide      # 引导舞台:GuideCanvas(拓扑)+ StepModal/PhasePanels(弹窗)+ KpiStrip
  components/StepAxis   # 底部轨道式步骤轴
  story/ data/ api/     # 时钟导演 / 场景契约 / LIVE 客户端(与 demo 逐行一致)
scripts/verify.mjs      # puppeteer-core 程序化验证
public/favicon.svg
```
