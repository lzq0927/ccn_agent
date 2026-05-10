# 核心网可靠性离散事件仿真系统

## 系统架构

代码位于 `simulator/` 包下，采用三阶段流水线设计：场景生成 → 仿真执行 → 数据导出。

### 模块说明

| 模块 | 职责 |
|---|---|
| `models.py` | 数据模型定义（NEType, FaultConfig, KPIRecord, Scenario等） |
| `topology.py` | 5种拓扑生成（1DC~2DC, 2~10资源池, 21~93个网元） |
| `process.py` | 5种业务流程定义（含3GPP协议消息）及UE路由选择 |
| `scenario.py` | 故障场景生成（10种故障类型 + 正常用例） |
| `engine.py` | 离散事件仿真引擎（60秒仿真，每秒计算link/trace/session三级KPI） |
| `exporter.py` | 数据导出为 data.csv, topo.txt, process.txt, result.txt |
| `main.py` | 主入口，串联三阶段流水线 |

### 运行方式

```bash
cd ccn_agent
python -m simulator.main
```

---

## 仿真模型

### 拓扑

- 2个DC，每个DC包含多个资源池，网元分批部署在不同资源池
- 网元间全互联，UDM/AUSF为主备模式，其余网元为负载均衡
- 5种拓扑规模：小(21 NE) → 大(93 NE)

### 业务流程

基于3GPP TS 23.502协议定义：

| 流程 | 协议章节 | 涉及网元类型 | 跳数 |
|---|---|---|---|
| PDU会话建立 | 4.3.2 | gNB, AMF, SMF, UDM, PCF, UPF | 12 |
| 注册 | 4.2.2 | gNB, AMF, AUSF, UDM | 10 |
| 切换 | 4.9.1 | gNB_src, gNB_tgt, AMF, SMF, UPF | 11 |
| PDU会话释放 | 4.3.4 | gNB, AMF, SMF, UPF, PCF | 10 |
| 服务请求 | 4.2.3 | gNB, AMF, SMF, UPF | 8 |

每个UE按负载均衡随机选择每类网元的一个实例，组成端到端路径。

### KPI层级

- **link**: 两点端到端链路成功率，物理层指标
- **trace**: 两点逐流程成功率，会话分段指标
- **session**: 会话全流程成功率，端到端指标（= 各trace成功率之积）

每秒采集一次，共60个时间点，故障发生在中间某时刻(20~35秒)。

### 故障模型

**故障模式**:
- LINK（物理链路故障）: 影响link/trace/session全部KPI
- BUSINESS（业务故障）: 仅影响trace/session KPI，不影响link

**故障点类型**:
- 显性: 单网元、多网元、同类型全故障、多类型全故障、资源池、DC
- 路径: link路径、trace路径、session路径（不聚合到网元）
- 隐性: 交换机故障（影响池内网元间通信）

**故障程度**: 丢包率3%~8%，带小幅随机波动(σ=0.5%)

**间接影响**: 故障网元的通信对端成功率也会下降，但因负载均衡机制，整体下降幅度被稀释。

---

## 生成的数据

### 数据统计

| 项目 | 数值 |
|---|---|
| 总用例数 | 100 |
| 正常用例 | 10 |
| 故障用例 | 90（NE故障54 + 链路故障36） |
| 训练集 | 40 (40%) |
| 测试集 | 60 (60%) |
| 仿真耗时 | ~15秒 |

### 目录结构

```
data/
├── split_info.json          # 训练/测试集划分
├── case1/
│   ├── data.csv             # KPI时序数据 (timestamp,level,ue_id,src,dst,success_rate)
│   ├── topo.txt             # 拓扑层级 (DC → 资源池 → 网元)
│   ├── process.txt          # 业务流程（3GPP协议消息，仅网元类型）
│   └── result.txt           # 预期故障结果 (fault_elements / fault_links)
├── case2/
│   └── ...
└── case100/
    └── ...
```

### 文件格式

**data.csv**: KPI时序数据
```csv
timestamp,level,ue_id,src,dst,success_rate
1,link,,AMF_1,SMF_2,0.9972
1,trace,UE_1,gNB_2,AMF_3,0.9981
1,session,UE_1,,,0.9841
```

**topo.txt**: 拓扑层级（不含连接关系，连接关系从data.csv推导）
```
DC: DC1
  ResourcePool: RP_DC1_1
    AMF: AMF_3
    UDM: UDM_1(master), UDM_2(standby)
    ...
```

**process.txt**: 业务流程（3GPP协议消息，仅网元类型，不含具体实例）
```
Process: PDU_Session_Establishment
Description: PDU会话建立 (TS 23.502 4.3.2)

Message Flow:
  1. UE -> gNB: UL NAS Transport (PDU Session Establishment Request)
  2. gNB -> AMF: N2 Message (UL NAS Transport)
  3. AMF -> SMF: Nsmf_PDUSession_CreateSMContext Request
  ...
Required NE types: gNB, AMF, SMF, UDM, PCF, UPF
UE count: 81
```

**result.txt**: 预期故障标签（两字段互斥）
```json
{
  "fault_elements": ["AMF_2"],
  "fault_links": []
}
```
