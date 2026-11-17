# CHR 知识图谱

`graph.json` 当前是样例图谱（由 `datagen/catalog.py` 生成）。接入现网时用产品代码分析的结果替换，保持下面的结构即可，后端只读这个文件。

## 结构

```json
{ "meta": {...}, "nodes": [...], "edges": [...] }
```

| 节点 type | 关键字段 | 含义 |
|---|---|---|
| `CauseCode` | `id=cause:<码>`、`code`、`name`、`nf_type`、`procedure`、`interface`、`protocol`、`code_ref`、`desc` | 原因码及其产生位置、协议映射 |
| `Scenario` | `id=scn:...`、`name`、`category`、`signature`、`key`、`locate`、`recovery` | 原因码的一种产生场景 |
| `NFType` / `Interface` / `Procedure` | `name` | 网元类型、接口、流程 |

| 关系 | 方向 | 属性 | 含义 |
|---|---|---|---|
| `CAUSED_BY` | 原因码 → 场景 | `weight` 先验权重、`condition` 触发条件 | 该原因码可能由此场景产生 |
| `PROPAGATES_TO` | 原因码 → 原因码 | `prob` | 下游网元的失败会在上游网元表现为另一个原因码 |
| `RAISED_BY` / `OCCURS_IN` / `ON_INTERFACE` | 原因码 → 网元类型 / 流程 / 接口 | — | 归属关系 |

## 场景的聚集特征

交叉验证依赖 `Scenario.signature`：该场景下各分析维度应当“聚集（high）”还是“不聚集（low）”，`key` 是必须满足的关键维度。

| category | 含义 | signature（关键维度加粗） |
|---|---|---|
| `link` | 本端到对端的链路丢包/中断 | **local=high、peer=high**，pod/user/ran=low |
| `peer_nf` | 对端网元过载/故障 | **local=low、peer=high**，pod/user/ran=low |
| `local_nf` | 本端网元整体异常 | **local=high、peer=low**，pod/user/ran=low |
| `pod` | 本端单 POD 异常 | **local=high、pod=high** |
| `user` | 用户签约/终端问题 | **user=high** |
| `ran` | 基站/小区/区域问题 | **ran=high** |
| `config` | 配置问题 | user/ran/pod=low |
| `propagated` | 下游失败传导 | 无（由用户业务流核对） |

`locate.peer_type` 指明 `peer` 维度对应哪一类对端网元，`locate.mode` 区分丢包（`packet_loss`）与中断（`down`）等。
