# 过载场景实时仿真数据模式(SIM)— 实施总结

## 概述
frontend-flow 与 frontend-show 原仅有 DEMO(确定性回放)模式。本次新增 **SIM 实时仿真模式**:
UE 实时产生注册 / PDU 会话建立流程,高稳智能体实时监测并处置**物联网注册风暴过载场景(D/E 两策略)**。
两端各内置一份独立的确定性实时仿真引擎(浏览器内运行,不依赖后端)。

## 实时仿真引擎(`src/sim/`)
- `sim/types.ts`:`SimState`(相位、AMF/SMF CPU、注册/会话速率、物联重注册速率、2C 限流比、
  双通道准入比、收敛、智能体叙事、UE 事件流)、`SimEvent`、`SimPhase`、`SimStrategy`、`SIM_LOOP=52s`。
- `sim/engine.ts`(纯函数 + 种子 RNG):
  - **时间线**:`normal[0,8) → storm[8,14) → detect[14,18) → trace[18,26) → recover[26,36) → healed[36,52)` 循环。
  - **正常态**:UE 已注册,每秒一定比例发起 PDU 会话;AMF/SMF CPU ~40%。
  - **故障态**:物联应用平台故障 → 物联终端反复重注册(`iotRegRate` 峰值 ~900/s),注册风暴冲击 AMF、
    会话风暴冲击 SMF(CPU 峰值 ~92%/88%),流控扩散使 2C 手机会话被限流(`twoCThrottle`)。
  - **D 策略**:recover 期 AMF Reg Reject + back-off timer(全员支持)→ 风暴强度快速收敛。
  - **E 策略**:首轮 back-off 仅 20% 物联支持 → 仅部分缓解、仍过载;二轮 UFDR 溯源后 AMF 限 NSSAI +
    SMF 限 APN,比例按容量/流量/CPU 反压实调节(`nssaiLimit/apnLimit`)→ 收敛。
  - `genEvents`:按当前速率采样生成 UE 事件(注册 成功/拒绝、PDU 会话 成功/限流/失败),保留最近 14 条。

## SIM 视图(`components/Sim/SimView.tsx`)
自驱动时钟(setInterval 200ms,dt=0.2×speed)推进引擎,实时渲染:
- **相位时间轴**:稳态/风暴/检测/溯源/恢复/收敛,当前相位高亮 + 进度。
- **AMF/SMF CPU 仪表** + 注册请求/物联重注册/PDU 会话/2C 限流比 实时条。
- **E 双通道准入限流**面板:NSSAI/APN 限制比 + 反压比例算法说明 + 首轮 20% 提示。
- **智能体实时叙事**:当前监测/处置动作。
- **UE 实时事件流**:滚动、按结果着色(成功/拒绝/限流/失败),区分 2C/物联。
- 控件:策略 D/E 切换、播放/暂停、0.5/1/2/4× 变速。

## 模式接入
- **frontend-flow**:TopBar 新增 `DEMO 演示 / SIM 实时仿真` 开关;`App` 顶层 `mode` 状态,SIM 时渲染 `SimView`
  替换两栏 DEMO 布局。
- **frontend-show**:TopBar 模式循环 `DEMO → LIVE → SIM`;`App` `mode` 三态,SIM 时早返回 `TopBar + SimView`。

## 验证
- `cd frontend-flow && npm run build` ✅(413 模块);`cd frontend-show && npm run build` ✅(417 模块)。
- `npm run dev`:切换到 SIM 模式 → 选策略 D/E → 观察正常→风暴(AMF/SMF CPU 飙升、2C 被限流、事件流刷屏)
  →检测→溯源→恢复(D back-off 快收敛 / E 首轮 20% 部分缓解→二轮 NSSAI+APN 限流收敛)→ 整网恢复,循环。

## 说明 / 后续
- 当前 SIM 引擎为**确定性浏览器内仿真**(种子 RNG),满足"UE 实时产生流程 + 智能体实时监测"的演示需求,
  无需后端。后续可替换为对接 Python simulator / 后端 WebSocket 的真实实时数据源(引擎接口 `stepSim` 不变)。
- DEMO 模式(场景 A–E 回放)与 SIM 模式(实时仿真)并存,顶栏一键切换。
