# 调研依据与设计取舍

调研日期：2026-11-16。先检查基础分支，再读取公开实现中的协议定义、错误结构和可视化能力，并检查本地 SciPy 的检验定义。未取得实验室原始表头或产品源码，因此内部错误点及其图谱均明确标为人工仿真规则。

## 1. 标准原因码和内部 CHR 码的边界

实际查阅 [Open5GS 的 `lib/nas/5gs/types.h`](https://github.com/open5gs/open5gs/blob/main/lib/nas/5gs/types.h)（文件 blob SHA `fd748bb679ffeb1664817b954c9da8e01f6ae153`）。该文件按 TS 24.501 分别列出 5GMM §9.11.3.2 和 5GSM §9.11.4.2 原因码。

| 命名空间 | 原因码 | 标准含义 | 本案例用途 |
|---|---:|---|---|
| 5GMM | 7 | 5GS services not allowed | 日常签约/权限噪声 |
| 5GMM | 22 | Congestion | 拥塞候选机制 |
| 5GMM | 90 | Payload was not forwarded | 上游失败现象，不能单独定位根因 |
| 5GSM | 26 | Insufficient resources | 资源不足候选 |
| 5GSM | 27 | Missing or unknown DNN | 稳定配置噪声；发生突增时也可告警 |
| 5GSM | 29 | User authentication or authorization failed | 个别用户问题 |
| 5GSM | 38 | Network failure | 泛化网络失败，不等同于丢包 |

同一个数字在 5GMM/5GSM 中意义可能不同，因此使用 `5GSM:27` 等带命名空间的标识。这里只引用事实性编号及语义，没有复制 Open5GS 实现代码。

实际查阅 [free5GC 的 ProblemDetails](https://github.com/free5gc/openapi/blob/main/models/model_problem_details.go)（blob SHA `6287b59752a7dcd394d0628a148a93a6fbd390fa`）。SBI 错误具有 HTTP status、应用 `cause`、detail 等不同层次，不能用 HTTP 状态码直接代替厂商 CHR 原因码。

仿真增加 `SIM_SBI_TIMEOUT`、`SIM_TRANSPORT_RETRANS_EXHAUSTED`、`SIM_AMF_UPSTREAM_FAILURE`。它们不是 3GPP 规定的通用内部原因码，也不是从用户产品源码提取的真实编号。图谱为每个码保存来源、语义信号和多个候选场景。仅出现超时不输出丢包结论。

## 2. 算法选择

- **时序异常**：分钟计数可能低频、零膨胀，也可能存在持续的高频噪声。采用前 15 分钟的中位数/MAD 与保守 Poisson 尾部分位数，选择较高阈值；最近 5 个已完成分钟中，同一维度至少 4 次超过阈值才确认。Poisson 并非真实网络流量的完整模型，MAD 作为补充；内网仍需校准。
- **显著性**：查阅安装的 `scipy.stats.fisher_exact` 文档，使用单侧 2×2 精确检验，检验异常样本特征相对背景是否富集。用 Benjamini–Hochberg 校正多重检验，并同时要求足够支持度和效应量，避免仅以 90%/60% 涂色。
- **失败链**：优先依赖 Trace ID；仅有 IMSI 和时间不能保证属于同一次流程，因此时间关联必须标注为候选，不能进入强因果证据。
- **图谱**：用可版本化 JSON 规则表达原因码→候选场景→所需证据。原型不依赖 Neo4j 或 LLM 服务，有利于离线部署和内网替换。未知码、近似候选、多项充分匹配均进入慢推理计划。

方法参考接口：[SciPy Fisher exact](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.fisher_exact.html)、[Poisson distribution](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.poisson.html)。实现细节与局限见 [架构说明](ARCHITECTURE.md)。

## 3. 白底分析工作台

实际查阅 [Apache ECharts 项目说明](https://github.com/apache/echarts/blob/master/README.md)（blob SHA `35164a15e30832259d8a0728adccfca7252d3f92`），选择其折线、饼图、散点和关系图能力。数据在后端计算，前端只负责展示与交互；静态资源本地打包，无运行时 CDN 依赖。

界面围绕值班分析人员的证据核验路径组织：

1. 上方三个工作流阶段显示真实后端当前阶段；第三阶段标注待交接。
2. 工作区先展示关键统计和结论，再通过拓扑定位，按需进入感知、聚类、图谱和交接视图。
3. 右侧使用独立滚动日志，明确 Pipeline 与 Agent 事件；不生成假的 Agent 输出。
4. 白底、浅灰边框、蓝色交互，橙红仅用于异常与显著证据；不使用监控大屏、荧光装饰或密集仪表盘。
5. 拓扑默认突出关联路径，可切换所有 full-mesh 连接。根因放大、高亮，异常传播和疑似后端链路采用不同线型。后端路径只突出有足够支持度的主要目标，避免背景偶发超时污染定位。
6. 窄屏折叠为单列，拓扑和表格可横向滚动；为图表附文字标签、为图表钻取提供可键盘操作的下拉框，支持减少动效。

时序、饼图和散点图保留明确的粒度和分母：原因码占比不是业务失败率，规则证据覆盖率不是统计校准后的故障概率。
