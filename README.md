# ccn_agent — 5GC 云核心网 CHR 故障感知与分析

基于 CHR（网元流程失败时记录的原因码等信息）做故障感知和根因分析，替代传统的 KPI 方式。
工作流为 **感知 → 分析 → 决策执行**；本系统实现感知与分析，结论移交决策执行模块（不实现执行）。

系统启动后持续实时运行：每分钟感知一次（15 分钟滑窗），发现异常自动降噪、分析并给出结论和恢复方案，故障消失后自动判定恢复。

## 启动

```bash
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
python -m backend --port 8000
```

浏览器打开 http://localhost:8000 。页面打开即显示当前实时状态，无需任何操作。

| 参数 | 环境变量 | 说明 |
|---|---|---|
| `--data-dir` | `CCN_DATA_DIR` | CHR 文件目录，默认 `data/` |
| `--topo` | `CCN_TOPO_FILE` | 拓扑文件，默认 `topo/topo.csv` |
| `--kg` | `CCN_KG_FILE` | 知识图谱文件，默认 `chr-knowledge-graph/graph.json` |
| `--host` / `--port` | — | 监听地址与端口，默认 `0.0.0.0:8000` |

## 实时运行方式

- **数据接入**：各网元把 CHR 逐条追加到 `<data-dir>/chr_<网元类型>.csv`。系统记住每个文件已读到的位置，只读新增的完整行；文件被截断或轮转时从头重读，新出现的文件自动纳入。
- **节拍**：以服务器本地时钟为准。每分钟结束后等待 5 秒（容纳晚到的记录），处理刚结束的这一分钟。CHR 时间戳需为服务器同一时区的本地时间，格式 `YYYY-MM-DD HH:MM:SS`。
- **启动预热**：启动时用数据源中最近 30 分钟的历史数据建立基线，不产生告警；没有历史数据时基线随实时数据逐步建立。
- **数据缺口**：整分钟没有收到任何 CHR 时按数据缺口处理，不当作 0 条参与基线，也不做判定，并在日志中提示检查数据源。
- **故障生命周期**：
  - 出现持续突增维度 → 开启故障（编号 `INC-日期-时分`），执行降噪与分析，给出结论并移交。
  - 故障期间继续每分钟感知；出现新的突增维度且距上次分析 ≥5 分钟时重新分析。已有确切结论时，只有新的确切结论才会替换它。
  - 故障相关维度连续 5 分钟回落到基线（每个维度至多 1 个孤立突增点）→ 判定恢复，关闭故障。
- **前端**：通过 SSE 订阅 `/api/stream`，连接后先收到当前状态快照，再接收后续事件；断线自动重连。

## 目录

| 路径 | 内容 |
|---|---|
| `data/chr_<网元类型>.csv` | CHR 数据，每类网元一个文件 |
| `topo/topo.csv` | 拓扑，列为 `source,target`，实例形如 `SMF:smf_2` |
| `chr-knowledge-graph/graph.json` | 知识图谱，结构见该目录下 README |
| `backend/engine.py` | 感知与分析引擎：每分钟处理一次，管理故障的开启、更新与恢复 |
| `backend/live.py` | 实时运行器：按真实时间驱动引擎，维护状态快照并广播事件 |
| `backend/source.py` | 实时数据源：增量读取持续追加的 CHR 文件 |
| `backend/perception/` | 感知：`preprocess.py` 预处理，`anomaly.py` 时序异常检测，`denoise.py` 降噪 |
| `backend/analysis/` | 分析：`flows.py` 业务流还原，`clustering.py` 特征聚类，`kg_reasoning.py` 图谱推理，`crossval.py` 交叉验证，`conclusion.py` 结论 |
| `backend/agent/` | 慢推理 Agent（桩实现）与工具 |
| `backend/server.py` | HTTP / SSE 服务；`backend/pipeline.py`、`cli.py` 为离线分析入口 |
| `frontend/` | React + TypeScript + Vite + ECharts |
| `datagen/` | 测试数据生成器（联调与测试用，运行时不依赖） |
| `tests/` | 测试 |

## 输入数据

公共列：`Timestamp, Inner_Cause, Procedure, IMSI, NE_Instance, RAN_ID, CELL_ID, TAC, POD_ID`

- AMF 追加：`Last_AMF_ID, Last_SMF_ID, Last_AUSF_ID, Last_UDM_ID, Last_PCF_ID`
- SMF 追加：`Serving_AMF_ID, Serving_UDM_ID, Serving_PCF_ID, Serving_UPF_ID`

`CELL_ID`、`TAC` 用于小区、区域维度的聚类；`Last_SMF_ID`、`Last_AUSF_ID`、`Serving_UPF_ID` 用于业务流还原与链路定位。
预处理按列名别名归一（见 `preprocess.py` 的 `ALIASES`），`Last_*_ID` / `Serving_*_ID` 自动识别为途经网元列，表头有出入时改别名表即可。

原因码为产品内部码并映射 3GPP 协议原因（TS 24.501 5GMM/5GSM、TS 29.500/29.502、TS 29.244）：
`MM-1xxx` AMF、`SM-2xxx` SMF、`AU-3xxx` AUSF、`UD-4xxx` UDM、`PC-5xxx` PCF、`UP-6xxx` UPF。

## 算法

**感知**（每分钟一次，15 分钟滑窗）

1. 预处理：列名归一、时间戳解析、去重、缺字段与未知实例剔除、实例名归一。
2. 时序异常检测，粒度为网元实例 + 流程 + 原因码，每分钟一个计数点：
   稳健 Z-Score，基线取正常点的中位数与均值之大者，离散度取 `max(1.4826·MAD, √μ, 1)`；
   `z ≥ 3` 且增量 ≥ 3 条/分钟记为突增点。已判为突增的点不参与基线估计，正常点不足时冻结基线，故障持续期间基线不会被抬高。
3. 持续性判定：最近 5 分钟内至少 4 分钟为突增点才认定异常并触发分析。
4. 降噪：只保留持续突增维度自突增起始之后的 CHR。触发时已连续突增 3 分钟的同期维度一并保留。

**分析**（对降噪后的数据）

1. 业务流还原：同一用户、同一流程、相邻 3 秒内的跨网元 CHR 串成失败路径，按调用深度由后端向前端排列，输出用户 ID、失败路径、AMF_ID、SMF_ID。
2. 特征聚类：对每个突增维度，在用户、基站、小区、区域、POD、对端网元、本端网元上计算聚集度。
   只对相对基线的增量计算；取增量最大的至多 3 个取值，聚集度 = (覆盖率 − 正常期望占比) / (1 − 正常期望占比)，
   并做二项检验。≥90% 为强聚集，≥60% 为中聚集。所有维度都不聚集时下钻到用户粒度，用该用户业务流途经的网元再分析一次。
3. 图谱推理：查出每个突增原因码的产生场景；沿传导关系并结合业务流，把维度分为根因侧与传导侧。
4. 交叉验证：图谱场景带有应呈现的聚集特征，逐个与聚类结果核对。根因侧维度都唯一匹配并归并为同一结论则输出；否则转慢推理 Agent。

**结论**：文字结论、关键证据、影响范围、恢复方案（链路/网元问题给出可用路径）、拓扑标注，以及移交决策执行模块的 JSON 载荷。

阈值集中在 `backend/config.py`。

## 接口

| 接口 | 说明 |
|---|---|
| `GET /api/stream` | 实时事件流（SSE）：快照 + 后续事件 |
| `GET /api/state` | 当前状态快照（JSON） |
| `GET /api/meta` | 运行配置概览 |
| `GET /api/topology` | 拓扑 |
| `GET /api/knowledge-graph` | 知识图谱全量 |

## 联调与测试

```bash
python -m pytest tests -q        # 测试
python -m backend.cli            # 对 data/ 中的历史 CHR 做离线分析，打印执行日志
cd frontend && npm run dev       # 前端开发模式（代理到 8000 端口）
```

没有现网数据时，可用测试数据生成器按真实时间持续写入 CHR，配合实时服务联调：

```bash
python -m datagen.generate --live --out runtime --fault-after 5 --fault-duration 10
python -m backend --port 8000 --data-dir runtime/data
```

`--fault-after 5` 表示启动 5 分钟后注入一次 `SMF:smf_2` 后端部分链路丢包（N7→pcf_2、N4→upf_1），`--fault-duration 10` 表示 10 分钟后恢复；不带 `--fault-after` 则只有常态底噪。
`data/` 下提交的是同一故障的 40 分钟历史样例（第 20 分钟注入），供离线分析与测试使用。

## 当前限制

- 慢推理 Agent 是规则化的桩实现，用户跟踪基于已有 CHR，拨测染色未接入。接口见 `backend/agent/slow_reasoning.py`。
- 同一时间只跟踪一起故障；并发的多起独立故障会被归入同一次分析，无法归并为单一结论时转慢推理。
- 运行状态只保存在内存中，服务重启后故障记录与日志不保留，基线靠数据源中的近期历史重新预热。
- 启动时会完整读取一遍现有 CHR 文件，文件很大时启动较慢，建议配合文件轮转。
- 知识图谱为样例，`code_ref` 等字段是示意值；交叉验证的聚集判定阈值（0.6 / 0.4）未按现网数据标定。
