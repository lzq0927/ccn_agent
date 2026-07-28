# frontend-flow LIVE 模式操作指南

> 场景 F(三层并行恢复·终端类型感知)真实接入;A-E 走 DEMO。
> 后端实时仿真 → 高稳智能体感知/诊断/恢复/评估 → 数据落盘。

## 一、启动(两个终端)

### 终端 1:后端(FastAPI + WebSocket,端口 8000)

```bash
cd D:/code/ccn_agent/ccn_agent
py -m uvicorn api.app:app --host 0.0.0.0 --port 8000 --reload
```

健康检查:
```bash
curl http://localhost:8000/health
# {"status":"ok"}

curl http://localhost:8000/api/v1/live/capabilities
# {"A":"demo","B":"demo","C":"demo","D":"demo","E":"demo","F":"live"}
```

### 终端 2:前端(Vite,端口 5175)

```bash
cd D:/code/ccn_agent/ccn_agent/frontend-flow
npm run dev
```

浏览器打开 **http://localhost:5175**。

> Vite 已配代理:`/api/*` 和 `/ws/*` 自动转发到 8000,前端代码不用管后端地址。
> `host: true` 允许同网段机器用你的 IP 访问(展会大屏)。

## 二、操作(浏览器)

1. 默认 DEMO 模式,自动循环播放场景 A。
2. 顶栏点场景 **`F`**(流控溯源·物联网风暴)。
3. 点 **`切到 LIVE`** → 前端 `POST /api/v1/live/select`,拿到 `session_id`,连 WS。
4. 后端 LiveRunner 状态机实时推进,事件流推送:
   - `simulating`(60 tick,KPI 曲线/CPU 仪表逐步展开)
   - `diagnosing`(推理链逐步揭示)
   - 首轮 confidence 0.28 < 0.3 → `confidence_low` → **回 Agent1 补采 CHR**(双轮)
   - `recovering`(首轮 3 策略并行 / 二轮排除 iPhone 微调)
   - `evaluating`(P/R/F1 + Skill 沉淀)
   - `done`

整个过程约 **15-20 秒**(默认 tick 0.15s/轮 + 阶段间 0.4s 节流),不再「一进去就到评估」。

## 三、查看生成的数据

**每个 LIVE session 落盘到 `storage/live_sessions/{session_id}/`**:

| 文件 | 内容 | 格式 |
|---|---|---|
| `session_meta.json` | session 元数据(场景/轮数/状态/时间) | JSON |
| `topo.txt` | 拓扑(DC → ResourcePool → NE) | 文本(同 storage/cases) |
| `process.txt` | 业务流模板(F:物联网注册风暴) | 文本 |
| `data.csv` | **KPI 时序**(sim_t, amf_cpu, smf_cpu, 物联/ToC 注册&会话数, 成功率) | CSV 宽表,Excel 直接打开 |
| `chr.jsonl` | CHR 记录(每行一条:ue/device/apn/cause_code) | JSON Lines |
| `alarms.jsonl` | 告警(CPU 过载 / 注册突增 / 准入控制生效) | JSON Lines |
| `reasoning.jsonl` | 推理步骤(逐步落盘) | JSON Lines |
| `recovery.json` | 恢复动作列表(UE/AMF/SMF 三层) | JSON |
| `evaluation.json` | 评估报告(P/R/F1/trace_axes) | JSON |
| `events.jsonl` | **全部 WS 事件流水**(最完整,断线重连回放也用它) | JSON Lines |

快速看一次跑的全部数据:
```bash
ls storage/live_sessions/                      # 列所有 session
SID=$(ls -t storage/live_sessions/ | head -1)  # 最新一个
ls storage/live_sessions/$SID/
head -5 storage/live_sessions/$SID/data.csv    # KPI 前几行
tail -3 storage/live_sessions/$SID/alarms.jsonl
cat storage/live_sessions/$SID/evaluation.json
```

`data.csv` 示例(Excel 打开即可画风暴曲线):
```
sim_t,round,amf_cpu,smf_cpu,iot_reg_rate,toc_reg_rate,iot_sess_rate,toc_sess_rate,amf_success_rate,smf_success_rate
1,1,40.0,38.0,5.0,15.0,40.0,300.0,0.995,0.995
...
29,1,82.5,80.75,136.25,19.5,285.0,345.0,0.8975,0.9088
```

## 四、调节奏

`POST /api/v1/live/select` 支持可选 `tick_interval`(秒):

| 值 | 效果 | 一轮时长 |
|---|---|---|
| `0.0` | 最快(测试用) | <1s |
| `0.15`(默认) | 演示节奏 | ~15s |
| `0.3` | 展会讲解节奏 | ~25s |

```bash
curl -X POST http://localhost:8000/api/v1/live/select \
  -H "Content-Type: application/json" \
  -d '{"scenario_id":"F","tick_interval":0.3}'
```

前端默认用 0.15。要改前端默认,改 `frontend-flow/src/api/live.ts` 的 `selectScenario` 加 `tick_interval` 字段。

## 五、降级与杀开关

| 场景 | 行为 |
|---|---|
| WS 断线 3s | 前端弹红色 toast「WS 断线,自动回 DEMO」+ 自动切 DEMO |
| 后端崩 / select 失败 | 同上 |
| LLM 失败(stub 模式不会) | 自动 fallback stub + 顶栏橙色徽标 |
| **关闭整个 LIVE 模块** | 后端启动前 `CC_LIVE_ENABLED=0`,`/api/v1/live/*` 和 `/ws/live` 全不加载 |

```bash
# 关 LIVE
CC_LIVE_ENABLED=0 py -m uvicorn api.app:app --port 8000
# 强制 stub(不调真实 LLM,展会稳态)
CC_LIVE_LLM_MODE=stub py -m uvicorn api.app:app --port 8000
```

## 六、场景 F 叙事(两轮)

**根因**:物联网应用平台故障 → 物联终端反复注册上线 → 注册/会话风暴冲击 AMF/SMF → 流控扩散影响正常 2C 手机。

| 轮 | sim_t | 发生了什么 | confidence |
|---|---|---|---|
| 1 | 1-30 | 稳态 → 风暴起(28)→ 攀升。3 策略并行下发(UE back-off + AMF NSSAI + SMF DNN)。但 iPhone 不支持 back-off timer,收到 Reg Reject 立即重试,**放大风暴、失败反升** | 0.28 < 0.3 |
| — | — | confidence 不足 → `loop②` 回 Agent1 补采 CHR(终端类型 × APN × back-off 支持) | — |
| 2 | 31-60 | 终端类型感知:**仅 iPhone 不支持 back-off**;APN 异常仅「物联网平台」。二轮对 iPhone 不下发 back-off(改由 AMF NSSAI 拦截),微调 AMF/SMF 限流比例。**失败陡降收敛** | 0.6 |
| — | — | Agent3 评估:已恢复 → 沉淀 `分层接纳 + 终端类型感知` Skill | — |

## 七、测试

```bash
py -m pytest tests/ -q                              # 后端 112 测试
cd frontend-flow && npx vitest run                  # 前端 12 测试
py -m pytest tests/integration/live/ -v             # LIVE 集成测试
```

> **TestClient 限制**:FastAPI TestClient 的 portal 在请求间隙不调度 background task,
> 所以 API 路径的测试只覆盖到 simulate 阶段。完整事件链路 + 数据落盘由
> `test_f_full_event_chain_direct` / `test_f_data_recorder_outputs_files`
> (直接 `await LiveRunner.run()`)覆盖。**生产环境 uvicorn 无此限制**,完整链路正常。

## 八、架构速查

```
浏览器 ──/api/v1/live/select──► api/routes/live.py
                                   │ create LiveRunner + LiveDataRecorder
                                   ▼
                              LiveRunner.run() [状态机]
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        LiveEngine            plugin(F).           LiveDataRecorder
        (60 tick)             diagnosis_llm_stub    (落盘 10 文件)
              │                    │
              ▼                    ▼
        plugin(F).on_tick     confidence < 0.3?
        (KPI/CHR/告警)            是 → restart(二轮)
              │                    否 → recover → evaluate → done
              ▼
        _SessionBus.publish ──WS──► 浏览器 liveBus ──► useLiveClock ──► mergeLive(DEMO 底板)
```
