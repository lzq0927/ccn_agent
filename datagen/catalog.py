"""5GC 测试数据目录：网元、接口、原因码、故障场景。

这里是测试数据与样例知识图谱的唯一来源。接入现网后，
chr-knowledge-graph/graph.json 由产品代码分析结果替换，本文件不再需要。

原因码设计：Inner Cause 为产品内部码，并给出 3GPP 协议原因映射
（TS 24.501 5GMM/5GSM、TS 29.500/29.502 SBI、TS 29.244 PFCP、TS 38.413 NGAP）。
"""
from __future__ import annotations

NF_TYPES = ["AMF", "SMF", "AUSF", "UDM", "PCF", "UPF"]
INSTANCES_PER_TYPE = 2
PODS_PER_INSTANCE = 2

# 存在服务化/参考点接口的网元类型对，两类之间 fullmesh
INTERFACES = {
    ("AMF", "SMF"): "N11",
    ("AMF", "AUSF"): "N12",
    ("AMF", "UDM"): "N8",
    ("AMF", "PCF"): "N15",
    ("SMF", "UDM"): "N10",
    ("SMF", "PCF"): "N7",
    ("SMF", "UPF"): "N4",
    ("AUSF", "UDM"): "N13",
}

PROCEDURES = [
    "初始注册", "移动性注册更新", "ServiceRequest", "寻呼",
    "PDU会话建立", "PDU会话修改", "PDU会话释放", "N2切换",
]


def inst(nf_type: str, idx: int) -> str:
    return f"{nf_type}:{nf_type.lower()}_{idx}"


def instances(nf_type: str) -> list[str]:
    return [inst(nf_type, i + 1) for i in range(INSTANCES_PER_TYPE)]


# ---------------------------------------------------------------- 场景模板
# signature：该场景下各分析维度应呈现的聚集特征，供交叉验证使用。
#   local=本端网元实例  peer=对端网元实例  pod=POD  user=用户  ran=基站/小区/区域
# key：判定该场景必须满足的关键维度。

def _scn(sid, name, category, signature, key, locate=None, recovery=""):
    return {"id": f"scn:{sid}", "type": "Scenario", "name": name, "category": category,
            "signature": signature, "key": key, "locate": locate or {}, "recovery": recovery}


def link_loss(local, peer, iface):
    return _scn(
        f"link_loss:{local}-{peer}", f"{local} 后端至 {peer} 的 {iface} 链路丢包/时延抖动", "link",
        {"local": "high", "peer": "high", "pod": "low", "user": "low", "ran": "low"}, ["local", "peer"],
        {"local_type": local, "peer_type": peer, "interface": iface, "mode": "packet_loss"},
        "将流量切换到本端至同类对端的其它可用链路，并排查故障链路的网卡/vSwitch/交换机端口丢包",
    )


def link_down(local, peer, iface):
    return _scn(
        f"link_down:{local}-{peer}", f"{local} 至 {peer} 的 {iface} 链路中断", "link",
        {"local": "high", "peer": "high", "pod": "low", "user": "low", "ran": "low"}, ["local", "peer"],
        {"local_type": local, "peer_type": peer, "interface": iface, "mode": "down"},
        "切换到其它可用链路，排查链路中断原因",
    )


def peer_overload(peer):
    return _scn(
        f"peer_overload:{peer}", f"对端 {peer} 过载/处理时延增大", "peer_nf",
        {"local": "low", "peer": "high", "pod": "low", "user": "low", "ran": "low"}, ["local", "peer"],
        {"peer_type": peer, "mode": "overload"},
        "对该对端实例限流或降低其选择权重，扩容后恢复",
    )


def peer_fault(peer):
    return _scn(
        f"peer_fault:{peer}", f"对端 {peer} 实例故障/进程异常", "peer_nf",
        {"local": "low", "peer": "high", "pod": "low", "user": "low", "ran": "low"}, ["local", "peer"],
        {"peer_type": peer, "mode": "fault"},
        "隔离该对端实例，业务切换至同类其它实例",
    )


def local_pod(local):
    return _scn(
        f"local_pod:{local}", f"本端 {local} 单 POD/进程异常", "pod",
        {"local": "high", "pod": "high", "user": "low", "ran": "low"}, ["local", "pod"],
        {"local_type": local, "mode": "pod"},
        "隔离并重建异常 POD",
    )


def local_nf(local):
    return _scn(
        f"local_nf:{local}", f"本端 {local} 网元整体异常（资源/过载）", "local_nf",
        {"local": "high", "peer": "low", "pod": "low", "user": "low", "ran": "low"}, ["local", "peer"],
        {"local_type": local, "mode": "nf"},
        "降低该网元选择权重，业务切换至同类其它实例",
    )


def user_issue(sid, name):
    return _scn(f"user:{sid}", name, "user", {"user": "high"}, ["user"], {"mode": "user"},
                "核查相关用户的签约/终端，不涉及网络侧恢复")


def ran_issue(sid, name):
    return _scn(f"ran:{sid}", name, "ran", {"ran": "high", "user": "low"}, ["ran"], {"mode": "ran"},
                "排查相关基站/小区的无线与传输状态")


def config_issue(sid, name):
    return _scn(f"config:{sid}", name, "config",
                {"user": "low", "ran": "low", "pod": "low"}, [], {"mode": "config"},
                "修改或回退相关配置")


def propagated(src_type):
    return _scn(f"propagated:{src_type}", f"下游 {src_type} 流程失败向上传导", "propagated",
                {}, [], {"peer_type": src_type, "mode": "propagated"},
                "定位下游网元的原始失败原因")


# ---------------------------------------------------------------- 原因码
# 字段：code, nf, name, procedure, interface, protocol(3GPP 映射), code_ref(示意代码位置),
#       desc, peers(该条 CHR 中有值的途经网元列), scenarios[(scenario, weight, condition)],
#       propagates_to[(上游原因码, 传导概率)]，多个上游互斥，按概率择一

def _c(code, nf, name, procedure, interface, protocol, code_ref, desc, peers, scenarios, propagates_to=()):
    return {"code": code, "nf": nf, "name": name, "procedure": procedure, "interface": interface,
            "protocol": protocol, "code_ref": code_ref, "desc": desc, "peers": list(peers),
            "scenarios": list(scenarios), "propagates_to": list(propagates_to)}


CAUSES = [
    # ------------------------------------------------------------ AMF
    _c("MM-1011", "AMF", "鉴权失败（AUSF 鉴权拒绝）", "初始注册", "N12",
       "5GMM #3 Illegal UE / AUTHENTICATION REJECT", "amf/mm/auth/AmfAuthProc.c:OnAuthResultFailure()",
       "AUSF 返回鉴权失败，AMF 下发鉴权拒绝", ["UDM", "AUSF"],
       [(user_issue("usim", "用户 USIM/鉴权密钥异常"), 0.7, "UE 上报的 RES* 与网络侧不一致"),
        (propagated("AUSF"), 0.2, "AUSF 侧鉴权流程失败传导"),
        (link_loss("AMF", "AUSF", "N12"), 0.1, "N12 请求/响应丢失导致鉴权结果异常")]),
    _c("MM-1015", "AMF", "用户未签约/签约数据不存在", "初始注册", "N8",
       "5GMM #7 5GS services not allowed；UDM 404 USER_NOT_FOUND", "amf/mm/reg/AmfRegUdmProc.c:OnSdmGetRsp()",
       "向 UDM 获取签约数据返回用户不存在", ["UDM", "AUSF"],
       [(user_issue("unsub", "用户未开户/已销户仍反复注册"), 0.75, "UDM 无该 IMSI 签约"),
        (config_issue("udm_data", "UDM 签约数据割接/同步缺失"), 0.15, "批量用户数据未同步"),
        (propagated("UDM"), 0.1, "UDM 侧失败传导")]),
    _c("MM-1018", "AMF", "N2 连接异常释放（注册过程中）", "初始注册", "N2",
       "NGAP Cause: radio-connection-with-ue-lost", "amf/ngap/AmfNgapUeCtx.c:OnUeContextReleaseReq()",
       "注册未完成时基站请求释放 UE 上下文", ["UDM"],
       [(ran_issue("gnb_reset", "基站复位/传输闪断"), 0.7, "单基站下用户集中重注册并失败"),
        (user_issue("ue_move", "UE 无线环境差"), 0.3, "个别用户弱覆盖")]),
    _c("MM-1021", "AMF", "跟踪区不允许/漫游限制", "移动性注册更新", "N1",
       "5GMM #12 Tracking area not allowed / #13 Roaming not allowed in this TA", "amf/mm/reg/AmfMobilityRestrict.c:CheckTaAllowed()",
       "用户所在 TA 命中移动性限制", ["UDM"],
       [(config_issue("ta_restrict", "TA/漫游限制配置"), 0.6, "边界 TA 配置了接入限制"),
        (user_issue("roam", "用户签约限制区域"), 0.4, "签约区域限制")]),
    _c("MM-1102", "AMF", "无线连接丢失/UE 无响应", "ServiceRequest", "N2",
       "NGAP Cause: radio-connection-with-ue-lost", "amf/mm/sr/AmfServiceReqProc.c:OnInitialCtxSetupFail()",
       "业务请求过程中空口无响应", [],
       [(ran_issue("weak_cov", "基站弱覆盖/干扰"), 0.6, "弱覆盖小区集中"),
        (user_issue("ue_radio", "UE 无线环境差"), 0.4, "个别用户")]),
    _c("MM-1105", "AMF", "PDU 会话用户面激活失败", "ServiceRequest", "N11",
       "Nsmf_PDUSession_UpdateSMContext 失败（500/504）", "amf/mm/sr/AmfSrSmCtxProc.c:OnUpdateSmContextRsp()",
       "业务请求中 SMF 未能激活用户面", [],
       [(propagated("SMF"), 0.7, "SMF 侧 N4 会话修改失败/超时后向 AMF 返回失败"),
        (link_loss("AMF", "SMF", "N11"), 0.15, "N11 链路丢包导致 UpdateSMContext 超时"),
        (peer_overload("SMF"), 0.15, "SMF 过载拒绝")]),
    _c("MM-1201", "AMF", "寻呼无响应", "寻呼", "N2",
       "T3513 超时", "amf/mm/paging/AmfPagingProc.c:OnT3513Expiry()",
       "寻呼多次重发后 UE 无响应", [],
       [(user_issue("ue_off", "UE 关机/脱网"), 0.6, "用户不在服务区"),
        (ran_issue("paging_cov", "基站覆盖问题"), 0.4, "弱覆盖区域")]),
    _c("MM-1301", "AMF", "DNN 不支持或未签约", "PDU会话建立", "N1",
       "5GMM #91 DNN not supported or not subscribed in the slice", "amf/sm/AmfSmfSelect.c:CheckDnnSubscribed()",
       "UE 请求的 DNN 不在签约/切片允许范围", ["AMF", "UDM", "PCF"],
       [(user_issue("wrong_dnn", "终端 DNN/APN 配置错误"), 0.6, "固定用户群反复请求错误 DNN"),
        (config_issue("dnn_cfg", "DNN/切片配置缺失"), 0.4, "网络侧未配置该 DNN")]),
    _c("MM-1305", "AMF", "SMF 拒绝会话建立", "PDU会话建立", "N11",
       "Nsmf_PDUSession_CreateSMContext 4xx/5xx（含 N1 SM 拒绝）", "amf/sm/AmfSmCtxProc.c:OnCreateSmContextRsp()",
       "SMF 返回会话建立失败", ["AMF", "UDM", "PCF", "SMF"],
       [(propagated("SMF"), 0.7, "SMF 侧会话建立任一环节失败后拒绝"),
        (peer_overload("SMF"), 0.2, "SMF 过载拒绝新建会话"),
        (link_loss("AMF", "SMF", "N11"), 0.1, "N11 响应异常")]),
    _c("MM-1306", "AMF", "N11 CreateSMContext 超时", "PDU会话建立", "N11",
       "504 Gateway Timeout / TIMED_OUT_REQUEST", "amf/sm/AmfSmCtxProc.c:OnCreateSmContextTimeout()",
       "等待 SMF 响应超时", ["AMF", "UDM", "PCF", "SMF"],
       [(link_loss("AMF", "SMF", "N11"), 0.4, "N11 链路丢包"),
        (peer_overload("SMF"), 0.3, "SMF 处理慢"),
        (propagated("SMF"), 0.3, "SMF 下游重传耗时超过 AMF 等待定时器")]),
    _c("MM-1401", "AMF", "切换目标侧资源准备失败", "N2切换", "N2",
       "NGAP HandoverPreparationFailure", "amf/ho/AmfN2HoProc.c:OnHandoverRequestFail()",
       "目标基站拒绝切换请求", [],
       [(ran_issue("ho_target", "目标基站资源不足"), 0.8, "目标小区拥塞"),
        (config_issue("nbr_cfg", "邻区配置错误"), 0.2, "邻区关系缺失")]),

    # ------------------------------------------------------------ SMF
    _c("SM-2001", "SMF", "DNN 缺失或未知", "PDU会话建立", "N1",
       "5GSM #27 Missing or unknown DNN", "smf/sm/est/SmfDnnCheck.c:ValidateDnn()",
       "SMF 本地未配置该 DNN", ["AMF"],
       [(user_issue("wrong_dnn_smf", "终端 DNN 配置错误"), 0.6, "固定用户群"),
        (config_issue("smf_dnn", "SMF DNN 配置缺失"), 0.4, "配置遗漏")],
       [("MM-1305", 0.9)]),
    _c("SM-2003", "SMF", "用户鉴权/授权失败（DN-AAA）", "PDU会话建立", "N6",
       "5GSM #29 User authentication or authorization failed", "smf/sm/est/SmfDnAaaProc.c:OnAccessReject()",
       "二次鉴权被 DN-AAA 拒绝", ["AMF", "UDM"],
       [(user_issue("dn_auth", "用户二次鉴权凭据错误"), 0.8, "企业专网用户口令错误"),
        (config_issue("aaa_cfg", "DN-AAA 对接配置"), 0.2, "共享密钥不一致")],
       [("MM-1305", 0.9)]),
    _c("SM-2005", "SMF", "资源不足（地址池）", "PDU会话建立", "-",
       "5GSM #26 Insufficient resources", "smf/ipam/SmfIpPool.c:AllocUeIp()",
       "DNN 地址池可用地址不足", ["AMF", "UDM", "PCF"],
       [(config_issue("ip_pool", "地址池规划不足"), 0.7, "个别 DNN 地址池耗尽"),
        (local_nf("SMF"), 0.3, "SMF 资源不足")],
       [("MM-1305", 0.9)]),
    _c("SM-2007", "SMF", "UE 无响应（N1/N2 超时）", "PDU会话建立", "N1N2",
       "T3591/N2 PDU Session Resource Setup 无响应", "smf/sm/est/SmfN1N2Proc.c:OnN1N2Timeout()",
       "下发会话接受后空口无响应", ["AMF", "UDM", "PCF", "UPF"],
       [(ran_issue("est_radio", "空口质量差"), 0.6, "弱覆盖"),
        (user_issue("ue_noresp", "UE 异常"), 0.4, "个别终端")]),
    _c("SM-2101", "SMF", "N7 SM 策略关联建立超时", "PDU会话建立", "N7",
       "Npcf_SMPolicyControl_Create 超时（504 / 对外 5GSM #38 Network failure）",
       "smf/pcc/SmfN7Client.c:OnSmPolicyCreateTimeout()",
       "向 PCF 发起 SM 策略关联建立，等待响应定时器超时且重发耗尽", ["AMF", "UDM", "PCF"],
       [(link_loss("SMF", "PCF", "N7"), 0.45, "SMF 后端至 PCF 的 N7 链路丢包/时延增大，请求或响应丢失，定时器超时"),
        (peer_overload("PCF"), 0.3, "PCF 过载，处理时延超过 SMF 等待定时器"),
        (peer_fault("PCF"), 0.15, "PCF 实例进程异常无响应"),
        (local_pod("SMF"), 0.1, "SMF 单 POD 的 SBI 客户端异常")],
       [("MM-1305", 0.84), ("MM-1306", 0.08)]),
    _c("SM-2102", "SMF", "PCF 拒绝策略建立", "PDU会话建立", "N7",
       "Npcf_SMPolicyControl_Create 403 POLICY_CONTEXT_DENIED / USER_UNKNOWN", "smf/pcc/SmfN7Client.c:OnSmPolicyCreateRsp()",
       "PCF 明确拒绝策略关联建立", ["AMF", "UDM", "PCF"],
       [(propagated("PCF"), 0.5, "PCF 策略决策失败传导"),
        (config_issue("pcf_policy", "PCF 策略签约缺失"), 0.3, "未配置该 DNN 策略"),
        (user_issue("pcf_user", "用户策略签约缺失"), 0.2, "个别用户")],
       [("MM-1305", 0.9)]),
    _c("SM-2103", "SMF", "PCF 不可达（连接失败）", "PDU会话建立", "N7",
       "TARGET_NF_NOT_REACHABLE / TCP 连接失败", "smf/pcc/SmfN7Client.c:OnConnectFail()",
       "至 PCF 的 SBI 连接建立失败", ["AMF", "UDM", "PCF"],
       [(link_down("SMF", "PCF", "N7"), 0.5, "N7 链路中断"),
        (peer_fault("PCF"), 0.5, "PCF 实例宕机")],
       [("MM-1305", 0.9)]),
    _c("SM-2105", "SMF", "策略更新执行失败（QoS 规则冲突）", "PDU会话修改", "N7",
       "5GSM #83 Semantic error in the QoS operation", "smf/pcc/SmfPccRuleInstall.c:InstallPccRules()",
       "PCF 下发的规则与现有 QoS 流冲突", ["AMF", "PCF", "UPF"],
       [(propagated("PCF"), 0.5, "PCF 规则冲突传导"),
        (config_issue("pcc_rule", "PCC 规则配置冲突"), 0.5, "规则优先级/过滤器冲突")]),
    _c("SM-2201", "SMF", "N4 会话建立超时", "PDU会话建立", "N4",
       "PFCP Session Establishment Request 重传耗尽（T1/N1，对外 5GSM #38 Network failure）",
       "smf/n4/SmfPfcpSession.c:OnSessEstTimeout()",
       "向 UPF 发送 PFCP 会话建立请求，T1 超时并重传 N1 次仍无响应", ["AMF", "UDM", "PCF", "UPF"],
       [(link_loss("SMF", "UPF", "N4"), 0.45, "SMF 后端至 UPF 的 N4 链路丢包，PFCP(UDP) 请求或响应丢失，重传耗尽"),
        (peer_overload("UPF"), 0.3, "UPF 过载，PFCP 处理时延过大"),
        (peer_fault("UPF"), 0.15, "UPF 实例异常无响应"),
        (local_pod("SMF"), 0.1, "SMF 单 POD 的 PFCP 协议栈异常")],
       [("MM-1305", 0.84), ("MM-1306", 0.08)]),
    _c("SM-2202", "SMF", "PFCP 路径故障（心跳超时）", "PDU会话建立", "N4",
       "PFCP Heartbeat 超时", "smf/n4/SmfPfcpPath.c:OnHeartbeatTimeout()",
       "至 UPF 的 PFCP 心跳连续超时，判定路径故障", ["AMF", "UPF"],
       [(link_down("SMF", "UPF", "N4"), 0.5, "N4 链路中断"),
        (peer_fault("UPF"), 0.5, "UPF 实例宕机")],
       [("MM-1305", 0.9)]),
    _c("SM-2203", "SMF", "UPF 拒绝会话建立", "PDU会话建立", "N4",
       "PFCP Cause 75 No resources available / 73 Rule creation/modification failure",
       "smf/n4/SmfPfcpSession.c:OnSessEstRsp()",
       "UPF 返回会话建立失败", ["AMF", "UDM", "PCF", "UPF"],
       [(propagated("UPF"), 0.6, "UPF 侧失败传导"),
        (config_issue("upf_rule", "下发规则 UPF 不支持"), 0.4, "规则/特性不匹配")],
       [("MM-1305", 0.9)]),
    _c("SM-2210", "SMF", "N4 会话修改超时", "PDU会话修改", "N4",
       "PFCP Session Modification Request 重传耗尽", "smf/n4/SmfPfcpSession.c:OnSessModTimeout()",
       "向 UPF 发送 PFCP 会话修改请求超时", ["AMF", "PCF", "UPF"],
       [(link_loss("SMF", "UPF", "N4"), 0.45, "SMF 后端至 UPF 的 N4 链路丢包，PFCP 请求或响应丢失"),
        (peer_overload("UPF"), 0.3, "UPF 过载"),
        (peer_fault("UPF"), 0.15, "UPF 实例异常无响应"),
        (local_pod("SMF"), 0.1, "SMF 单 POD 的 PFCP 协议栈异常")]),
    _c("SM-2211", "SMF", "N4 会话修改超时（用户面激活）", "ServiceRequest", "N4",
       "PFCP Session Modification Request 重传耗尽", "smf/n4/SmfPfcpSession.c:OnUpActivateTimeout()",
       "业务请求激活用户面时 PFCP 会话修改超时", ["AMF", "PCF", "UPF"],
       [(link_loss("SMF", "UPF", "N4"), 0.45, "SMF 后端至 UPF 的 N4 链路丢包，PFCP 请求或响应丢失"),
        (peer_overload("UPF"), 0.3, "UPF 过载"),
        (peer_fault("UPF"), 0.15, "UPF 实例异常无响应"),
        (local_pod("SMF"), 0.1, "SMF 单 POD 的 PFCP 协议栈异常")],
       [("MM-1105", 0.9)]),
    _c("SM-2301", "SMF", "N10 签约数据获取失败", "PDU会话建立", "N10",
       "Nudm_SDM_Get 404 DATA_NOT_FOUND / 504", "smf/sdm/SmfN10Client.c:OnSdmGetRsp()",
       "向 UDM 获取会话管理签约数据失败", ["AMF", "UDM"],
       [(propagated("UDM"), 0.5, "UDM 侧失败传导"),
        (user_issue("sm_sub", "用户无该 DNN 的会话签约"), 0.3, "签约缺失"),
        (link_loss("SMF", "UDM", "N10"), 0.2, "N10 链路丢包")],
       [("MM-1305", 0.9)]),
    _c("SM-2401", "SMF", "释放流程 UE 无响应", "PDU会话释放", "N1",
       "T3592 超时", "smf/sm/rel/SmfReleaseProc.c:OnT3592Expiry()",
       "网络侧发起释放后 UE 未确认，本地释放", ["AMF", "PCF", "UPF"],
       [(user_issue("rel_noresp", "UE 已脱网"), 0.6, "用户不可达"),
        (ran_issue("rel_radio", "空口质量差"), 0.4, "弱覆盖")]),

    # ------------------------------------------------------------ AUSF
    _c("AU-3001", "AUSF", "鉴权向量获取失败", "初始注册", "N13",
       "Nudm_UEAuthentication_Get 失败", "ausf/auth/AusfUdmClient.c:OnGenerateAuthDataRsp()",
       "向 UDM 获取鉴权向量失败", [],
       [(user_issue("au_sub", "用户鉴权数据缺失"), 0.6, "签约无鉴权数据"),
        (link_loss("AUSF", "UDM", "N13"), 0.4, "N13 链路异常")]),
    _c("AU-3002", "AUSF", "RES* 校验失败", "初始注册", "N12",
       "5G-AKA HRES* 不匹配", "ausf/auth/Ausf5gAka.c:VerifyResStar()",
       "UE 返回的鉴权响应校验不通过", [],
       [(user_issue("au_key", "用户 USIM 密钥不一致"), 1.0, "卡数据问题")],
       [("MM-1011", 0.95)]),

    # ------------------------------------------------------------ UDM
    _c("UD-4001", "UDM", "用户不存在", "初始注册", "N8",
       "404 USER_NOT_FOUND", "udm/sdm/UdmSubsQuery.c:QuerySubscriber()",
       "签约库无该用户", [],
       [(user_issue("ud_unsub", "用户未开户/已销户"), 0.85, "固定用户群反复尝试"),
        (config_issue("ud_sync", "签约数据同步缺失"), 0.15, "割接遗漏")],
       [("MM-1015", 0.95)]),
    _c("UD-4002", "UDM", "会话签约数据缺失", "PDU会话建立", "N10",
       "404 DATA_NOT_FOUND", "udm/sdm/UdmSmDataQuery.c:QuerySmData()",
       "用户无该 DNN/切片的会话管理签约", [],
       [(user_issue("ud_sm", "用户会话签约缺失"), 1.0, "签约问题")],
       [("SM-2301", 0.9)]),
    _c("UD-4010", "UDM", "UECM 注册冲突", "初始注册", "N8",
       "Nudm_UECM_Registration 409", "udm/uecm/UdmAmfReg.c:RegisterAmf()",
       "同一用户并发注册导致上下文冲突", [],
       [(user_issue("ud_conc", "用户频繁重注册"), 1.0, "终端行为")]),

    # ------------------------------------------------------------ PCF
    _c("PC-5001", "PCF", "SM 策略决策失败（签约策略缺失）", "PDU会话建立", "N7",
       "403 POLICY_CONTEXT_DENIED", "pcf/smpolicy/PcfSmPolicyDecision.c:MakeDecision()",
       "未找到匹配的会话策略", [],
       [(config_issue("pc_policy", "策略签约/规则配置缺失"), 0.6, "配置遗漏"),
        (user_issue("pc_user", "用户策略签约缺失"), 0.4, "个别用户")],
       [("SM-2102", 0.95)]),
    _c("PC-5002", "PCF", "AM 策略关联建立失败", "初始注册", "N15",
       "Npcf_AMPolicyControl_Create 失败", "pcf/ampolicy/PcfAmPolicyCreate.c:OnCreate()",
       "接入与移动性策略创建失败", [],
       [(config_issue("pc_am", "AM 策略配置缺失"), 1.0, "配置问题")]),
    _c("PC-5010", "PCF", "策略规则冲突", "PDU会话修改", "N7",
       "规则安装失败上报", "pcf/smpolicy/PcfRuleReport.c:OnRuleReport()",
       "SMF 上报规则安装失败", [],
       [(config_issue("pc_rule", "PCC 规则冲突"), 1.0, "规则配置")],
       [("SM-2105", 0.9)]),

    # ------------------------------------------------------------ UPF
    _c("UP-6001", "UPF", "PFCP 规则创建失败", "PDU会话建立", "N4",
       "PFCP Cause 73 Rule creation/modification Failure", "upf/pfcp/UpfRuleInstall.c:CreatePdr()",
       "PDR/FAR 创建失败", [],
       [(config_issue("up_rule", "规则/特性不支持"), 1.0, "配置问题")],
       [("SM-2203", 0.95)]),
    _c("UP-6003", "UPF", "会话上下文不存在", "PDU会话修改", "N4",
       "PFCP Cause 65 Session context not found", "upf/pfcp/UpfSessMgr.c:FindSession()",
       "修改/删除的会话在 UPF 已不存在", [],
       [(user_issue("up_ctx", "会话上下文不同步"), 1.0, "个别会话")]),
    _c("UP-6005", "UPF", "资源不足（TEID/会话数）", "PDU会话建立", "N4",
       "PFCP Cause 75 No resources available", "upf/res/UpfTeidAlloc.c:AllocTeid()",
       "资源分配失败", [],
       [(local_nf("UPF"), 1.0, "UPF 资源不足")],
       [("SM-2203", 0.95)]),
]

CAUSE_BY_CODE = {c["code"]: c for c in CAUSES}
