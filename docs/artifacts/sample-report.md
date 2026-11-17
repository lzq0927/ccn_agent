# CHR 故障分析报告

分析窗口：2026-11-16T09:09:00+00:00 至 2026-11-16T09:24:00+00:00（右开区间）

结论：SMF:smf_2 后端部分链路丢包（CHR 证据推断）

检查 51 个时序维度；2145 条 CHR → 701 条；过滤 67.32%。
确认 8 个维度；精确关联 320 条跨网元用户流程。

## 关键证据

- 匹配：异常来源实例在跨实例对照中显著富集
- 匹配：异常集中于实例内的一个 POD，且相对背景显著
- 匹配：涉及至少 20 用户、8 基站及 3 区域
- 匹配：异常涉及两个及以上后端网元类型
- 匹配：有 TRACE_ID 精确关联的下游到上游失败传播
- 匹配：异常包含传输重传耗尽原因码

规则证据覆盖率：100%，不是校准概率。

## 恢复建议（未执行）

1. 将 SMF:smf_2 / smf_2-pod-1 的受影响后端路径从新会话选择中摘除。
2. 新建会话优先经 SMF:smf_1 到达 PCF:pcf_1, UDM:udm_1；已有会话按会话连续性策略排空，不直接搬迁。
3. 修复故障路径后用染色拨测确认；逐步恢复流量，持续观察至少 15 分钟 CHR 回归基线。

执行前提：
- 候选替代路径在拓扑中可达、当前滑窗未检出同类异常；这不等于已验证健康。
- 决策模块执行前必须核验实时可达性、容量、会话亲和及路由策略。

证据边界：CHR 不能直接测量丢包率，也不能排除所有传输拥塞/主机网络栈问题；上线需结合链路探测确认。

## 聚集性检验

| 网元 / 流程 / 原因码 | 维度 | 聚集值 | 占比 | Lift | q 值 |
|---|---|---|---:|---:|---:|
| SMF:smf_2 / PduSessionEstablishment / SIM_TRANSPORT_RETRANS_EXHAUSTED | 网元 | SMF:smf_2 | 100.0% | 4.84 | 2.2e-48 |
| SMF:smf_2 / PduSessionEstablishment / SIM_TRANSPORT_RETRANS_EXHAUSTED | POD | smf_2-pod-1 | 100.0% | 1.828 | 6.7e-13 |
| SMF:smf_2 / ServiceRequest / SIM_SBI_TIMEOUT | POD | smf_2-pod-1 | 100.0% | 1.968 | 1.4e-11 |
| SMF:smf_2 / PduSessionEstablishment / SIM_SBI_TIMEOUT | 网元 | SMF:smf_2 | 100.0% | 1.803 | 2.9e-16 |
| SMF:smf_2 / ServiceRequest / SIM_TRANSPORT_RETRANS_EXHAUSTED | POD | smf_2-pod-1 | 100.0% | 1.968 | 5.4e-07 |

图谱版本：1.0.0。
决策交接已生成但未发送，决策执行模块未实现。
