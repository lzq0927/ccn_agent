# ccn_agent — 5GC 云核心网 CHR 故障感知与分析

基于 CHR（网元流程失败时记录的原因码等信息）做故障感知和根因分析，替代传统的 KPI 方式。
工作流为 **感知 → 分析 → 决策执行**；本系统实现感知与分析，结论移交决策执行模块（不实现执行）。

当前全部使用仿真数据。默认场景：共 40 分钟数据，第 20 分钟起 `SMF:smf_2` 后端部分链路丢包。
回放时系统在 10:24 告警并得出结论 “SMF:smf_2 后端部分链路丢包（N7→PCF:pcf_2、N4→UPF:upf_1）”。

## 快速开始

```bash
pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
uvicorn backend.server:app --port 8000
```

浏览器打开 http://localhost:8000 ，点“开始回放”。

其它用法：

```bash
python -m backend.cli                 # 命令行回放，打印执行日志
python -m backend.cli --json          # 只输出结论 JSON
python -m simulator.generate --seed 7 # 重新生成仿真数据（拓扑、CHR、知识图谱）
python -m pytest tests -q             # 测试
cd frontend && npm run dev            # 前端开发模式（代理到 8000 端口）
```

## 目录

| 路径 | 内容 |
|---|---|
| `data/chr_<网元类型>.csv` | CHR 数据，每类网元一个文件 |
| `topo/topo.csv` | 拓扑，列为 `source,target`，实例形如 `SMF:smf_2` |
| `chr-knowledge-graph/graph.json` | 知识图谱，结构见该目录下 README |
| `simulator/` | 仿真：`catalog.py` 原因码与场景目录，`generate.py` 生成器 |
| `backend/perception/` | 感知：`preprocess.py` 预处理，`anomaly.py` 时序异常检测，`denoise.py` 降噪 |
| `backend/analysis/` | 分析：`flows.py` 业务流还原，`clustering.py` 特征聚类，`kg_reasoning.py` 图谱推理，`crossval.py` 交叉验证，`conclusion.py` 结论 |
| `backend/agent/` | 慢推理 Agent（桩实现）与工具 |
| `backend/pipeline.py` | 回放编排，输出事件流；`server.py` 为 HTTP/SSE 服务 |
| `frontend/` | React + TypeScript + Vite + ECharts |

## 输入数据

公共列：`Timestamp, Inner_Cause, Procedure, IMSI, NE_Instance, RAN_ID, CELL_ID, TAC, POD_ID`

- AMF 追加：`Last_AMF_ID, Last_SMF_ID, Last_AUSF_ID, Last_UDM_ID, Last_PCF_ID`
- SMF 追加：`Serving_AMF_ID, Serving_UDM_ID, Serving_PCF_ID, Serving_UPF_ID`

相对需求给出的表头，增加了 `CELL_ID`、`TAC`（聚类需要小区、区域维度）以及 `Last_SMF_ID`、`Last_AUSF_ID`、`Serving_UPF_ID`（业务流还原与链路定位需要）。
预处理按列名别名归一（见 `preprocess.py` 的 `ALIASES`），`Last_*_ID` / `Serving_*_ID` 自动识别为途经网元列，真实表头有出入时改别名表即可。

原因码为产品内部码并映射 3GPP 协议原因（TS 24.501 5GMM/5GSM、TS 29.500/29.502、TS 29.244）：
`MM-1xxx` AMF、`SM-2xxx` SMF、`AU-3xxx` AUSF、`UD-4xxx` UDM、`PC-5xxx` PCF、`UP-6xxx` UPF，完整列表见 `simulator/catalog.py`。

仿真数据包含：常态底噪（个别用户、配置、弱覆盖基站、网络抖动）、一次约 100 秒的瞬时毛刺（10:11 单基站闪断，不应告警）、脏数据（重复、缺字段、非法时间戳、实例名简写），以及第 20 分钟起的故障。
`data/scenario_truth.json` 记录注入的故障，仅用于说明和测试，后端不读取。

## 算法

**感知**（每分钟一次，15 分钟滑窗）

1. 预处理：列名归一、时间戳解析、去重、缺字段与未知实例剔除、实例名归一。
2. 时序异常检测，粒度为网元实例 + 流程 + 原因码，每分钟一个计数点：
   稳健 Z-Score，基线取正常点的中位数与均值之大者，离散度取 `max(1.4826·MAD, √μ, 1)`；
   `z ≥ 3` 且增量 ≥ 3 条/分钟记为突增点。已判为突增的点不参与基线估计，正常点不足时冻结基线。
3. 持续性判定：最近 5 分钟内至少 4 分钟为突增点才认定异常并触发分析。
4. 降噪：只保留持续突增维度自突增起始之后的 CHR。告警触发时已连续突增 3 分钟的同期维度一并保留，避免同一故障的证据因晚一分钟达标被滤掉。

**分析**（对降噪后的数据）

1. 业务流还原：同一用户、同一流程、相邻 3 秒内的跨网元 CHR 串成失败路径，按调用深度由后端向前端排列，输出用户 ID、失败路径、AMF_ID、SMF_ID。
2. 特征聚类：对每个突增维度，在用户、基站、小区、区域、POD、对端网元、本端网元上计算聚集度。
   只对相对基线的增量计算；取增量最大的至多 3 个取值，聚集度 = (覆盖率 − 正常期望占比) / (1 − 正常期望占比)，
   并做二项检验。≥90% 为强聚集，≥60% 为中聚集。所有维度都不聚集时下钻到用户粒度，用该用户业务流途经的网元再分析一次。
3. 图谱推理：查出每个突增原因码的产生场景；沿传导关系并结合业务流，把维度分为根因侧与传导侧。
4. 交叉验证：图谱场景带有应呈现的聚集特征，逐个与聚类结果核对。根因侧维度都唯一匹配并归并为同一结论则输出；否则转慢推理 Agent。

**结论**：文字结论、关键证据、影响范围、恢复方案（链路/网元问题给出可用路径）、拓扑标注，以及移交决策执行模块的 JSON 载荷。

阈值集中在 `backend/config.py`。

## 当前限制

- 慢推理 Agent 是规则化的桩实现，用户跟踪基于已有 CHR，拨测染色未接入；默认数据不会触发它。接口见 `backend/agent/slow_reasoning.py`。
- 回放在得出第一个结论后结束，不处理同一次回放中的多起故障，也不跟踪故障恢复。
- 知识图谱为示例，`code_ref` 等字段是示意值。
- 交叉验证的聚集/不聚集判定阈值（0.6 / 0.4）是固定值，未按真实数据标定。

## 替换为内网数据

| 替换内容 | 做法 |
|---|---|
| CHR | 放入 `data/chr_*.csv`；列名不同则改 `preprocess.py` 的别名表 |
| 拓扑 | 替换 `topo/topo.csv`；新增网元类型时补 `topology.py` 的接口表、`config.py` 的调用深度、前端 `Topology.tsx` 的版式 |
| 知识图谱 | 按 `chr-knowledge-graph/README.md` 的结构替换 `graph.json` |
| 算法 | 各步骤是独立函数，输入输出为 DataFrame / dict，可在 `pipeline.py` 中逐个替换 |
