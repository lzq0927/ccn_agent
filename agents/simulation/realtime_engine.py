"""RealtimeEngine: 真实的、消息级离散事件 5GC 仿真器(LIVE 闭环核心)。

与 ``simulator/engine.py`` 的批量 Monte-Carlo 不同,这是一个**有状态、逐 tick 推进、
事件驱动**的引擎:每个仿真秒生成一批 UE 到达(注册 / PDU 建立),每条信令消息作为
一个事件入堆,按仿真时间顺序逐跳处理(查 NE 存活 / 故障丢损 / 策略准入),成功才推进
下一跳,流程终跳到达时更新 AMF 注册 / SMF PDU 会话的成功率与请求数。

关键能力(支撑 LIVE 闭环):
- ``inject_fault(fc)``:中途注入故障,标记 NE degraded/down,iot_storm 抬升到达 λ。
- ``apply_policy(actions)``:执行恢复策略(isolate / reroute / flow_control),**真改仿真状态**,
  后续 tick 的 KPI 随之变化(SR 回升、CPU 下降)——非只发事件。
- ``is_recovered()``:据 AMF/SMF SR + CPU 判定网络是否恢复。
- ``snapshot()``:本 tick 的 KPI 快照 + 待发 chr_record/alarm 事件(推 WS + 落盘)。
- ``snapshot_for_agent()``:累积的 KPI/CHR/拓扑/真值,组装成 Agent 的 CaseData。

复用:``simulator.process.PROCESS_DEFINITIONS``(注册 10 跳 / PDU 12 跳 + 消息名)、
``simulator.subscriber.SubscriberRegistry``、``simulator.chr_generator.CHRGenerator``、
``agents.simulation.demo_topology``。
"""
from __future__ import annotations

import heapq
import logging
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional

from simulator.chr_generator import CHRGenerator
from simulator.models import FaultConfig, NEType, Topology
from simulator.process import PROCESS_DEFINITIONS
from simulator.subscriber import SubscriberRegistry

from agents.simulation.demo_topology import build_demo_topology, render_topo_text

logger = logging.getLogger(__name__)

_SR_RECOVER_THRESHOLD = 0.99    # SR 回到该线以上视为恢复(健康≈0.998,故障≈0.975,留足裕度)
_CPU_RECOVER_THRESHOLD = 80.0   # CPU 降到该线以下视为恢复
_ROLLING_WINDOW = 12            # 滚动窗口(tick 数),用于 SR/CPU 平滑
_KPI_BUFFER_LINK = 400          # 给 Agent 的 link KPI 缓存上限
_KPI_BUFFER_TRACE = 800
_CHR_BUFFER = 600

# 各 NE 类型的基线 CPU(百分比)
_BASE_CPU = {
    "AMF": 38.0, "SMF": 36.0, "UPF": 32.0, "PCF": 22.0, "UDM": 18.0,
    "AUSF": 16.0, "NRF": 12.0, "NSSF": 20.0, "gNB": 28.0,
}
# 每被一条消息「触碰」折算的 CPU 增量(每 tick);标定:健康态 ≈ base+5,风暴 8x → ~88
_CPU_PER_TOUCH = {
    "AMF": 0.10, "SMF": 0.10, "UPF": 0.05, "PCF": 0.08, "UDM": 0.09,
    "AUSF": 0.08, "NRF": 0.04, "NSSF": 0.07, "gNB": 0.04,
}


@dataclass
class UeBinding:
    """单个 UE 的「主控」NE 实例绑定 + 业务画像(供风暴场景分群)。"""
    ue_id: str
    ne: dict[str, str]  # {ne_type_str -> instance_id},如 {"AMF": "AMF_1"}
    device_type: str = "toc"          # "toc" | "iot-meter" | "iot-cam" | "iphone" ...
    sst: int = 1                      # 切片 SST(1=ToC, 3=MIoT)
    dnn: str = "internet"
    supports_backoff: bool = True


@dataclass
class PolicyAction:
    kind: str  # "isolate" | "reroute" | "flow_control"
    # isolate
    ne_id: str = ""
    # reroute: 把绑到 from_ne_id 的会话重选到同型的健康实例(不指定 to 则自动挑)
    from_ne_id: str = ""
    to_ne_id: str = ""
    # flow_control: 在 layer(AMF/SMF/UE)按 ratio 拒绝匹配 filter 的到达
    layer: str = ""
    ratio: float = 0.0
    flt: dict = field(default_factory=dict)  # {"sst": 3} / {"dnn": "iot"} / {"device_type": "iphone"}


@dataclass
class TickSnapshot:
    sim_t: int
    round: int
    kpi: dict
    chr_records: list[dict]
    alarms: list[dict]


class RealtimeEngine:
    """消息级离散事件 5GC 仿真器(有状态,逐 tick 推进)。"""

    def __init__(
        self,
        topology: Topology | None = None,
        scenario: Any | None = None,
        seed: int = 42,
    ):
        self.topology = topology or build_demo_topology()
        self.scenario = scenario
        self._rng = random.Random(seed)
        self._seq = 0
        self.sim_t = 0
        self.round = 1

        # NE 状态
        self._ne_status: dict[str, str] = {ne_id: "up" for ne_id in self.topology.elements}
        self._ne_loss: dict[str, float] = {}        # degraded NE 的丢损率
        self._ne_cpu: dict[str, float] = {ne_id: _BASE_CPU[ne.ne_type.value] for ne_id, ne in self.topology.elements.items()}

        # UE 绑定 + 订阅者身份 + CHR 生成器
        self.bindings: list[UeBinding] = []
        self._build_bindings()
        self._subscribers = SubscriberRegistry(case_id=seed, ue_count=len(self.bindings))
        self._chr_gen = CHRGenerator(case_id=seed, background_fail_rate=0.001)

        # 事件堆:(sim_time, seq, hop_dict)
        self._heap: list[tuple[float, int, dict]] = []

        # 故障 / 策略
        self.fault: Optional[FaultConfig] = None
        self._policies: list[PolicyAction] = []
        self._pending_alarms: list[dict] = []
        self._loss_flt: dict = {}   # 故障丢损的业务类别过滤(空=全类别)

        # 滚动计数(每 tick 一格)
        self._win_reg: deque[tuple[int, int]] = deque(maxlen=_ROLLING_WINDOW)  # (req, succ)
        self._win_pdu: deque[tuple[int, int]] = deque(maxlen=_ROLLING_WINDOW)
        self._win_touch: deque[dict[str, int]] = deque(maxlen=_ROLLING_WINDOW)
        # 每有向链路逐 tick 的 (att,succ) 滚动窗口 → 稳定的局向 KPI(避免单 tick 小样本抖动)
        self._win_link: deque[dict[tuple[str, str], list[int]]] = deque(maxlen=_ROLLING_WINDOW)
        # per-NE 实例的注册/PDU 端到端成功率滚动窗口(供前端②弹窗画 per-NE SR 曲线·均质化比较)。
        # 每元素 = {ne_id: [att, succ]};仅 AMF 实例进 reg、SMF 实例进 pdu(主控 NF 维度)。
        self._win_ne_reg: deque[dict[str, list[int]]] = deque(maxlen=_ROLLING_WINDOW)
        self._win_ne_pdu: deque[dict[str, list[int]]] = deque(maxlen=_ROLLING_WINDOW)
        # 流控拒绝滚动窗口(每 tick (backoff, admission),供 KPI 快照观测流控效果)
        self._win_rejects: deque[tuple[int, int]] = deque(maxlen=_ROLLING_WINDOW)

        # 给 Agent 的累积缓冲
        self._kpi_link: deque[dict] = deque(maxlen=_KPI_BUFFER_LINK)
        self._kpi_trace: deque[dict] = deque(maxlen=_KPI_BUFFER_TRACE)
        self._chr_buffer: deque[dict] = deque(maxlen=_CHR_BUFFER)

        # 本 tick 累计
        self._tick_reg_req = self._tick_reg_succ = 0
        self._tick_pdu_req = self._tick_pdu_succ = 0
        self._tick_iot_reg = self._tick_toc_reg = 0
        self._tick_iot_sess = self._tick_toc_sess = 0
        self._tick_backoff_rejects = 0       # UE back-off 抑制的到达(未产生请求)
        self._tick_admission_rejects = 0     # AMF/SMF 准入拒绝(计请求不计成功)
        self._tick_touch: dict[str, int] = {}
        self._tick_link: dict[tuple[str, str], list[int]] = {}  # (s,d)->[att,succ]
        self._tick_chr: list[dict] = []
        # per-NE 实例本 tick 的 att/succ(注册按 AMF、PDU 按 SMF 主控 NF)
        self._tick_ne_reg_att: dict[str, int] = {}
        self._tick_ne_reg_succ: dict[str, int] = {}
        self._tick_ne_pdu_att: dict[str, int] = {}
        self._tick_ne_pdu_succ: dict[str, int] = {}

    # ------------------------------------------------------------------
    # 初始化:按场景分布生成 UE 绑定(负载均衡,master/standby 感知)
    # ------------------------------------------------------------------
    def _build_bindings(self) -> None:
        scen = self.scenario
        ue_count = int(getattr(scen, "ue_count", 80)) if scen else 80
        iot_ratio = float(getattr(scen, "iot_ratio", 0.0)) if scen else 0.0
        for i in range(ue_count):
            ue_id = f"UE_{i + 1}"
            binding = UeBinding(ue_id=ue_id, ne=self._select_ne_instances())
            if iot_ratio > 0 and (i / max(1, ue_count)) < iot_ratio:
                binding.device_type = self._rng.choice(["iot-meter", "iot-cam", "windows-iot"])
                binding.sst = 3
                binding.dnn = "iot"
                binding.supports_backoff = self._rng.random() > 0.35  # 部分不支持 back-off
            self.bindings.append(binding)

    def _select_ne_instances(self) -> dict[str, str]:
        """每类型挑一个实例(负载均衡;master/standby 优先 master)。"""
        chosen: dict[str, str] = {}
        for ne_type in (NEType.gNB, NEType.AMF, NEType.SMF, NEType.UPF, NEType.UDM, NEType.AUSF, NEType.PCF):
            instances = self.topology.get_elements_by_type(ne_type)
            if not instances:
                continue
            healthy = [n for n in instances if self._ne_status.get(n.id, "up") == "up"]
            pool = healthy or instances
            if ne_type in (NEType.UDM, NEType.AUSF):
                masters = [n for n in pool if n.role == "master"]
                if masters:
                    chosen[ne_type.value] = masters[0].id
                    continue
            chosen[ne_type.value] = self._rng.choice(pool).id
        return chosen

    # ------------------------------------------------------------------
    # 推进一个仿真秒(DES 核心)
    # ------------------------------------------------------------------
    def advance_tick(self, sim_t: int) -> TickSnapshot:
        self.sim_t = sim_t
        self._reset_tick_accums()

        # 1) 生成到达:按业务类别 λ(受故障激增调制;流控在逐条发起时执行)
        arrivals = self._arrivals_for_tick()
        self._tick_iot_reg = sum(1 for b, p in arrivals if p == "Registration" and b.sst == 3)
        self._tick_toc_reg = sum(1 for b, p in arrivals if p == "Registration" and b.sst != 3)
        self._tick_iot_sess = sum(1 for b, p in arrivals if p != "Registration" and b.sst == 3)
        self._tick_toc_sess = sum(1 for b, p in arrivals if p != "Registration" and b.sst != 3)
        for binding, proc_name in arrivals:
            self._spawn_attempt(binding, proc_name)

        # 2) 排空事件堆:逐跳处理本 tick 内全部信令消息
        while self._heap and self._heap[0][0] < sim_t + 1:
            _, _, hop = heapq.heappop(self._heap)
            self._process_hop(hop, sim_t)

        # 3) 滚动窗口 + 快照
        self._win_reg.append((self._tick_reg_req, self._tick_reg_succ))
        self._win_pdu.append((self._tick_pdu_req, self._tick_pdu_succ))
        self._win_touch.append(dict(self._tick_touch))
        self._win_rejects.append((self._tick_backoff_rejects, self._tick_admission_rejects))
        # per-NE 实例 att/succ → 滚动窗口(仅本 tick 有请求的 NE 入窗;缺席 tick 不计入该 NE 的分母)
        self._win_ne_reg.append({ne: [att, self._tick_ne_reg_succ.get(ne, 0)] for ne, att in self._tick_ne_reg_att.items()})
        self._win_ne_pdu.append({ne: [att, self._tick_ne_pdu_succ.get(ne, 0)] for ne, att in self._tick_ne_pdu_att.items()})
        self._update_cpu()
        self._accumulate_kpi_rows(sim_t)

        alarms = self._pending_alarms
        self._pending_alarms = []
        return TickSnapshot(
            sim_t=sim_t,
            round=self.round,
            kpi=self._kpi_snapshot(),
            chr_records=list(self._tick_chr),  # 本 tick 新增的 CHR(runner 推 WS + 落盘)
            alarms=alarms,
        )

    def _reset_tick_accums(self) -> None:
        self._tick_reg_req = self._tick_reg_succ = 0
        self._tick_pdu_req = self._tick_pdu_succ = 0
        self._tick_iot_reg = self._tick_toc_reg = 0
        self._tick_iot_sess = self._tick_toc_sess = 0
        self._tick_backoff_rejects = 0
        self._tick_admission_rejects = 0
        self._tick_touch = {}
        self._tick_link = {}
        self._tick_chr = []
        self._tick_ne_reg_att = {}
        self._tick_ne_reg_succ = {}
        self._tick_ne_pdu_att = {}
        self._tick_ne_pdu_succ = {}

    # ------------------------------------------------------------------
    # 到达模型(按业务类别)
    # ------------------------------------------------------------------
    def _class_bindings(self) -> dict[tuple[int, str], list[UeBinding]]:
        """按业务类别 (sst, dnn) 分组 UE 绑定(到达生成 / 类别归因共用)。"""
        classes: dict[tuple[int, str], list[UeBinding]] = {}
        for b in self.bindings:
            classes.setdefault((b.sst, b.dnn), []).append(b)
        return classes

    @staticmethod
    def _matches_flt(binding: UeBinding, flt: dict) -> bool:
        """策略/激增过滤器是否命中该 UE 的业务画像(sst/dnn/device_type)。"""
        if not flt:
            return True
        attrs = {"sst": binding.sst, "dnn": binding.dnn, "device_type": binding.device_type}
        return all(attrs.get(k) == v for k, v in flt.items())

    def _surge_multiplier(self, binding: UeBinding) -> float:
        """故障激增倍数:仅 surge_filter 命中的类别激增(空过滤器=全体)。"""
        if self.fault and self.fault.surge_multiplier > 1.0:
            if self._matches_flt(binding, self.fault.surge_filter or {}):
                return self.fault.surge_multiplier
        return 1.0

    def _ue_backoff_ratio(self, binding: UeBinding) -> float:
        """UE 层 back-off 对该终端的实际抑制比(不支持 back-off 的终端为 0)。"""
        if not binding.supports_backoff:
            return 0.0
        ratio = 0.0
        for p in self._policies:
            if p.kind != "flow_control" or p.layer != "UE":
                continue
            if self._matches_flt(binding, p.flt):
                ratio = max(ratio, p.ratio)
        return min(ratio, 0.98)

    def _nf_admission_ratio(self, binding: UeBinding, proc_name: str) -> float:
        """AMF(注册)/SMF(PDU)网络侧准入抑制比(flt 命中即全效,与终端支持无关)。"""
        layer = "AMF" if proc_name == "Registration" else "SMF"
        ratio = 0.0
        for p in self._policies:
            if p.kind != "flow_control" or p.layer != layer:
                continue
            if self._matches_flt(binding, p.flt):
                ratio = max(ratio, p.ratio)
        return min(ratio, 0.98)

    def _arrivals_for_tick(self) -> list[tuple[UeBinding, str]]:
        """按业务类别生成到达:λ_c = base_λ × 类别占比 × 激增倍数。

        flow_control 不在 λ 层削减——UE back-off / AMF·SMF 准入在 _spawn_attempt
        逐条执行(终端是否支持 back-off、准入拒绝是否计请求,均按真实语义)。
        返回 [(binding, proc_name)] 待发起列表(已打散)。
        """
        scen = self.scenario
        base_reg = float(getattr(scen, "base_reg_lambda", 14.0)) if scen else 14.0
        base_pdu = float(getattr(scen, "base_pdu_lambda", 26.0)) if scen else 26.0
        total = max(1, len(self.bindings))

        arrivals: list[tuple[UeBinding, str]] = []
        for (sst, dnn), members in self._class_bindings().items():
            share = len(members) / total
            surge = self._surge_multiplier(members[0])
            for _ in range(self._poisson(base_reg * share * surge)):
                arrivals.append((self._rng.choice(members), "Registration"))
            for _ in range(self._poisson(base_pdu * share * surge)):
                arrivals.append((self._rng.choice(members), "PDU_Session_Establishment"))
        self._rng.shuffle(arrivals)
        return arrivals

    def _poisson(self, lam: float) -> int:
        if lam <= 0:
            return 0
        return self._rng.randint(0, int(2 * lam)) if lam < 4 else int(self._rng.gauss(lam, lam ** 0.5 / 2))

    # ------------------------------------------------------------------
    # 事件处理:一条信令跳
    # ------------------------------------------------------------------
    def _spawn_attempt(self, binding: UeBinding, proc_name: str) -> None:
        # 0) UE back-off:终端自身抑制(不产生请求;不支持 back-off 的终端不受影响)
        if self._rng.random() < self._ue_backoff_ratio(binding):
            self._tick_backoff_rejects += 1
            return
        hops = self._materialize_hops(proc_name, binding)
        if not hops:
            return
        nf = binding.ne.get("AMF") if proc_name == "Registration" else binding.ne.get("SMF")
        # 1) 网络侧准入(策略 flow_control,AMF NSSAI / SMF DNN):flt 命中即按 ratio 拒绝。
        #    **有意准入拒绝不计入服务 SR**(单独观测 admission_rejects;与拥塞失败区分);
        #    出一条 CHR 供归因。
        if nf and self._rng.random() < self._nf_admission_ratio(binding, proc_name):
            self._tick_admission_rejects += 1
            self._emit_chr(self.sim_t, binding, proc_name, 0, binding.ue_id, nf,
                           "Admission Reject", True)
            return
        # 请求计数:注册→AMF,PDU→SMF(拥塞拒绝计 att;per-NE 实例同步计 att)
        if proc_name == "Registration":
            self._tick_reg_req += 1
            amf = binding.ne.get("AMF", "")
            if amf:
                self._tick_ne_reg_att[amf] = self._tick_ne_reg_att.get(amf, 0) + 1
        else:
            self._tick_pdu_req += 1
            smf = binding.ne.get("SMF", "")
            if smf:
                self._tick_ne_pdu_att[smf] = self._tick_ne_pdu_att.get(smf, 0) + 1
        # 2) 拥塞准入:负责 NF(AMF/SMF)CPU 过载时按过载程度拒绝(风暴场景的 SR 下降来源)
        cpu = self._ne_cpu.get(nf, 0.0) if nf else 0.0
        if cpu >= 80 and self._rng.random() < (cpu - 80) / 120:
            # 拥塞拒绝:计请求(已在上面),不计成功;在 NF 的接纳自环链路记一笔失败,
            # 让风暴期的 AMF/SMF 过载在 link KPI 可见(供 Agent 识别为 all_type_ne 过载,
            # 而非健康链路 + 散点 CHR 的模糊信号)
            if nf:
                a = self._tick_link.setdefault((nf, nf), [0, 0])
                a[0] += 1  # attempts++, successes 不增 → 该 NE 自环 SR 下降
            self._emit_chr(self.sim_t, binding, proc_name, 0, binding.ue_id, nf or "",
                           "Congestion Reject", True)
            return
        attempt_id = f"{binding.ue_id}-{proc_name}-{self._seq}"
        first_src, first_dst, first_msg = hops[0]
        self._push_hop(sim_t=self.sim_t, attempt_id=attempt_id, proc_name=proc_name,
                       binding=binding, hop_idx=0, hops=hops, src=first_src, dst=first_dst, message=first_msg)

    def _push_hop(self, *, sim_t, attempt_id, proc_name, binding, hop_idx, hops, src, dst, message) -> None:
        self._seq += 1
        heapq.heappush(self._heap, (sim_t + hop_idx * 1e-6, self._seq, {
            "attempt_id": attempt_id, "proc_name": proc_name, "binding": binding,
            "hop_idx": hop_idx, "hops": hops, "src": src, "dst": dst, "message": message,
        }))

    def _process_hop(self, hop: dict, sim_t: int) -> None:
        binding: UeBinding = hop["binding"]
        proc_name = hop["proc_name"]
        hop_idx = hop["hop_idx"]
        hops = hop["hops"]
        src, dst, message = hop["src"], hop["dst"], hop["message"]
        ue_id = binding.ue_id

        success, fault_hit = self._hop_outcome(src, dst, binding, proc_name)

        # 触碰 NE(CPU 负载)+ 局向计数
        for ne_id in (src, dst):
            if ne_id and ne_id != ue_id and ne_id in self._ne_cpu:
                self._tick_touch[ne_id] = self._tick_touch.get(ne_id, 0) + 1
        if src != ue_id and dst != ue_id:
            key = (src, dst)
            att_succ = self._tick_link.setdefault(key, [0, 0])
            att_succ[0] += 1
            if success:
                att_succ[1] += 1

        # CHR(free5GC 风格,与 Agent 工具一致)
        self._emit_chr(sim_t, binding, proc_name, hop_idx, src, dst, message, fault_hit)

        is_last = hop_idx >= len(hops) - 1
        if success and not is_last:
            nsrc, ndst, nmsg = hops[hop_idx + 1]
            self._push_hop(sim_t=sim_t, attempt_id=hop["attempt_id"], proc_name=proc_name,
                           binding=binding, hop_idx=hop_idx + 1, hops=hops, src=nsrc, dst=ndst, message=nmsg)
        elif success and is_last:
            # 流程成功完成 → 计成功(整条流程任一跳失败都不计;per-NE 实例同步计 succ)
            if proc_name == "Registration":
                self._tick_reg_succ += 1
                amf = binding.ne.get("AMF", "")
                if amf:
                    self._tick_ne_reg_succ[amf] = self._tick_ne_reg_succ.get(amf, 0) + 1
            else:
                self._tick_pdu_succ += 1
                smf = binding.ne.get("SMF", "")
                if smf:
                    self._tick_ne_pdu_succ[smf] = self._tick_ne_pdu_succ.get(smf, 0) + 1
        # 失败:流程中止(请求已计,成功不计)

    def _hop_outcome(self, src: str, dst: str, binding: UeBinding, proc_name: str) -> tuple[bool, bool]:
        """判定一跳成功/失败 + 是否命中故障(供 CHR cause code)。

        背景噪声压到现网真实水平(无线 0.0001 / SBI 0.00005,单跳 ≥99.99%),
        使健康窗口 SR(≈0.999)稳定高于恢复判定线 0.99 —— 否则小样本尾部抖动
        会让「已恢复」状态来回翻转;故障期的 SR 下降完全来自故障/拥塞本身。
        """
        ue_id = binding.ue_id
        # UE 无线跳:背景噪声
        if src == ue_id or dst == ue_id:
            return self._rng.random() > 0.0001, False
        # 任一 NE 宕机 → 失败
        if self._ne_status.get(src) == "down" or self._ne_status.get(dst) == "down":
            return False, True
        # degraded NE(link/single_ne 故障):按 loss 丢损(可按业务类别过滤——
        # 如 gNB 仅对物联终端群体异常,loss_filter={"sst": 3})
        for ne_id in (src, dst):
            loss = self._ne_loss.get(ne_id)
            if loss and self._matches_flt(binding, self._loss_flt) and self._rng.random() < loss:
                return False, True
        # 背景噪声
        return self._rng.random() > 0.00005, False

    # ------------------------------------------------------------------
    # CHR / KPI 累积
    # ------------------------------------------------------------------
    def _emit_chr(self, sim_t, binding, proc_name, hop_idx, src, dst, message, fault_hit) -> None:
        # CHR 采样:故障命中全留(诊断关键);健康跳只抽 3% 做基线,避免逐跳 CHR 灌爆 WS/落盘
        if not fault_hit and self._rng.random() > 0.03:
            return
        subscriber = self._subscribers.get(binding.ue_id)
        if subscriber is None:
            return
        session = self._subscribers.session(binding.ue_id)
        proc_def = PROCESS_DEFINITIONS[proc_name]
        tmpl_src, tmpl_dst = proc_def["hops"][hop_idx]
        rec = self._chr_gen.emit(
            t=sim_t, ue_id=binding.ue_id, subscriber=subscriber, session=session,
            procedure_type=proc_name, msg_hop=f"{tmpl_src}->{tmpl_dst}",
            nf_src=src, nf_dst=dst, service=self._derive_service(message, tmpl_src, tmpl_dst),
            message_name=message, fault_active=self.fault is not None, fault_hit=fault_hit,
            fault_mode=(self.fault.fault_mode if self.fault else None),
            fault_point_type=(self.fault.fault_point_type if self.fault else None),
        )
        self._chr_buffer.append({
            "timestamp": rec.timestamp, "supi": rec.supi,
            "pdu_session_id": rec.pdu_session_id, "procedure_type": rec.procedure_type,
            "msg_hop": rec.msg_hop, "nf_src": rec.nf_src, "nf_dst": rec.nf_dst,
            "service": rec.service, "sbi_status": rec.sbi_status, "outcome": rec.outcome,
            "cause5gmm": rec.cause5gmm, "cause5gsm": rec.cause5gsm,
            "latency_ms": rec.latency_ms, "message_name": rec.message_name, "ue_id": rec.ue_id,
        })
        self._tick_chr.append(self._chr_buffer[-1])

    @staticmethod
    def _derive_service(message_name: str, src_type: str, dst_type: str) -> str:
        token = message_name.split()[0] if message_name else ""
        if token.startswith("N") and "_" in token:
            return token
        return f"{src_type}->{dst_type}"

    def _accumulate_kpi_rows(self, sim_t: int) -> None:
        # 把本 tick 每有向链路计数压入滚动窗口,再聚合成稳定 SR(单 tick 小样本会抖动)
        self._win_link.append({k: list(v) for k, v in self._tick_link.items()})
        agg: dict[tuple[str, str], list[int]] = {}
        for tick_links in self._win_link:
            for (s, d), (att, succ) in tick_links.items():
                a = agg.setdefault((s, d), [0, 0])
                a[0] += att
                a[1] += succ
        # link 级(每有向链路一行,滚动窗口稳定 SR)—— Agent 单网元定位的主要信号源
        for (src, dst), (att, succ) in agg.items():
            sr = succ / att if att else 1.0
            self._kpi_link.append({
                "timestamp": sim_t, "level": "link", "ue_id": "", "src": src, "dst": dst,
                "success_rate": round(sr, 6), "procedure": "live",
            })
        # session 级(本 tick 整体成功率)—— 供严重度/时序特征
        total_req = self._tick_reg_req + self._tick_pdu_req
        total_succ = self._tick_reg_succ + self._tick_pdu_succ
        if total_req > 0:
            self._kpi_trace.append({
                "timestamp": sim_t, "level": "session", "ue_id": "", "src": "", "dst": "",
                "success_rate": round(total_succ / total_req, 6), "procedure": "live",
            })

    # ------------------------------------------------------------------
    # 故障注入 / 策略执行 / 恢复判定
    # ------------------------------------------------------------------
    def inject_fault(self, fc: FaultConfig) -> None:
        self.fault = fc
        affected = set(fc.affected_ne_ids or [])
        is_surge = fc.surge_multiplier > 1.0
        self._loss_flt = dict(fc.loss_filter or {})
        if not is_surge:
            # 单网元 / 链路类:per-hop 丢损(degraded);极端 loss 视为 down。
            # loss_filter 非空时仅匹配类别丢损(如 gNB 仅对物联终端群体异常)。
            for ne_id in affected:
                self._ne_loss[ne_id] = max(self._ne_loss.get(ne_id, 0.0), fc.loss_rate)
                if fc.loss_rate >= 0.5 and not self._loss_flt:
                    self._ne_status[ne_id] = "down"
        # 业务激增类不设 per-hop loss:靠 surge_multiplier 抬升匹配类别到达
        # → AMF/SMF CPU 过载 → _spawn_attempt 的拥塞准入拒绝(适度 SR 下降 + 拥塞 CHR)
        self._pending_alarms.append({
            "sim_t": self.sim_t, "ne_id": sorted(affected)[0] if affected else "",
            "severity": "major", "category": "fault_injected",
            "message": f"故障注入:{fc.fault_point_type.value} / {fc.fault_mode.value} @ {sorted(affected)}",
        })

    def apply_policy(self, actions: list[PolicyAction]) -> None:
        for a in actions:
            self._policies.append(a)
            if a.kind == "isolate" and a.ne_id:
                self._ne_status[a.ne_id] = "down"
                self._ne_loss[a.ne_id] = max(self._ne_loss.get(a.ne_id, 0.0), 0.99)
                self._pending_alarms.append({
                    "sim_t": self.sim_t, "ne_id": a.ne_id, "severity": "info",
                    "category": "isolate", "message": f"隔离 {a.ne_id}",
                })
            elif a.kind == "reroute" and a.from_ne_id:
                self._reroute_sessions(a.from_ne_id, a.to_ne_id)
            elif a.kind == "flow_control":
                # ratio 已在 _compute_throttle 生效;此处仅记告警
                self._pending_alarms.append({
                    "sim_t": self.sim_t, "ne_id": a.layer, "severity": "info",
                    "category": "flow_control",
                    "message": f"{a.layer} 流控 ratio={a.ratio:.2f} filter={a.flt}",
                })

    def _reroute_sessions(self, from_ne_id: str, to_ne_id: str = "") -> None:
        """把绑到 from_ne_id 的 UE 会话重选到同型健康实例。"""
        ne = self.topology.elements.get(from_ne_id)
        if ne is None:
            return
        ne_type = ne.ne_type
        candidates = [n for n in self.topology.get_elements_by_type(ne_type)
                      if n.id != from_ne_id and self._ne_status.get(n.id, "up") == "up"]
        if not candidates:
            candidates = [n for n in self.topology.get_elements_by_type(ne_type) if n.id != from_ne_id]
        if not candidates:
            return
        target = to_ne_id or self._rng.choice(candidates).id
        for b in self.bindings:
            if b.ne.get(ne_type.value) == from_ne_id:
                b.ne[ne_type.value] = target

    def is_recovered(self) -> bool:
        reg_sr, pdu_sr = self._success_rates()
        max_cpu = max(
            (cpu for nid, cpu in self._ne_cpu.items()
             if not nid.startswith("gNB")),
            default=0.0,
        )
        return reg_sr >= _SR_RECOVER_THRESHOLD and pdu_sr >= _SR_RECOVER_THRESHOLD and max_cpu < _CPU_RECOVER_THRESHOLD

    # ------------------------------------------------------------------
    # 快照
    # ------------------------------------------------------------------
    def _success_rates(self) -> tuple[float, float]:
        reg_req = sum(r for r, _ in self._win_reg) or 1
        reg_sr = sum(s for _, s in self._win_reg) / reg_req
        pdu_req = sum(r for r, _ in self._win_pdu) or 1
        pdu_sr = sum(s for _, s in self._win_pdu) / pdu_req
        return reg_sr, pdu_sr

    def _ne_success_rates(self, window: deque) -> dict[str, float]:
        """per-NE 实例的端到端业务成功率(滚动窗口聚合 [att,succ] → succ/att)。"""
        agg: dict[str, list[int]] = {}
        for snap in window:
            for ne, (att, succ) in snap.items():
                a = agg.setdefault(ne, [0, 0])
                a[0] += att
                a[1] += succ
        return {ne: (s / a if a else 1.0) for ne, (a, s) in agg.items()}

    def _update_cpu(self) -> None:
        # 按滚动窗口平均 touches 推 CPU(EMA 平滑,响应故障/策略)
        for ne_id, ne in self.topology.elements.items():
            t = ne.ne_type.value
            base = _BASE_CPU[t]
            coeff = _CPU_PER_TOUCH[t]
            avg_touch = sum(w.get(ne_id, 0) for w in self._win_touch) / max(1, len(self._win_touch))
            target = min(100.0, base + coeff * avg_touch)
            prev = self._ne_cpu.get(ne_id, base)
            self._ne_cpu[ne_id] = round(prev * 0.4 + target * 0.6, 2)

    def _kpi_snapshot(self) -> dict:
        reg_sr, pdu_sr = self._success_rates()
        amf_cpu = max((self._ne_cpu[n.id] for n in self.topology.get_elements_by_type(NEType.AMF)), default=0.0)
        smf_cpu = max((self._ne_cpu[n.id] for n in self.topology.get_elements_by_type(NEType.SMF)), default=0.0)
        reg_req = sum(r for r, _ in self._win_reg)
        pdu_req = sum(r for r, _ in self._win_pdu)
        return {
            "sim_t": self.sim_t, "round": self.round,
            "amf_success_rate": round(reg_sr, 4), "smf_success_rate": round(pdu_sr, 4),
            "amf_reg_requests": reg_req, "smf_pdu_requests": pdu_req,
            "iot_reg_rate": self._tick_iot_reg, "toc_reg_rate": self._tick_toc_reg,
            "iot_sess_rate": self._tick_iot_sess, "toc_sess_rate": self._tick_toc_sess,
            "amf_cpu": round(amf_cpu, 2), "smf_cpu": round(smf_cpu, 2),
            "ne_cpu": dict(self._ne_cpu),
            # 流控观测(滚动窗口内累计):UE back-off 抑制数 / AMF·SMF 准入拒绝数
            "backoff_rejects": sum(b for b, _ in self._win_rejects),
            "admission_rejects": sum(a for _, a in self._win_rejects),
            # 局向异常:用滚动窗口聚合(稳定),非单 tick 小样本(否则会闪烁/漏显)
            "link_anomalies": self._rolling_link_anomalies(),
            # 全部有向链路的滚动 SR(供前端按链路累积时序曲线,画「路径 KPI 曲线」)
            "link_sr": self._rolling_link_sr(),
            # per-NE 实例端到端业务 SR(AMF 注册 / SMF PDU,供②弹窗均质化比较曲线)
            "ne_reg_sr": self._ne_success_rates(self._win_ne_reg),
            "ne_pdu_sr": self._ne_success_rates(self._win_ne_pdu),
        }

    def _rolling_link_sr(self) -> dict[str, float]:
        agg: dict[tuple[str, str], list[int]] = {}
        for tick_links in self._win_link:
            for (s, d), (att, succ) in tick_links.items():
                a = agg.setdefault((s, d), [0, 0])
                a[0] += att
                a[1] += succ
        return {f"{s}->{d}": round(succ / att, 4) for (s, d), (att, succ) in agg.items() if att}

    def _rolling_link_anomalies(self) -> list[dict]:
        agg: dict[tuple[str, str], list[int]] = {}
        for tick_links in self._win_link:
            for (s, d), (att, succ) in tick_links.items():
                a = agg.setdefault((s, d), [0, 0])
                a[0] += att
                a[1] += succ
        return [
            {"src": s, "dst": d, "success_rate": round(succ / att, 4)}
            for (s, d), (att, succ) in agg.items() if att and succ / att < 0.995
        ]

    @property
    def ne_cpu(self) -> dict[str, float]:
        return dict(self._ne_cpu)

    @property
    def ne_reg_sr(self) -> dict[str, float]:
        """per-AMF 实例注册 SR(实时)。"""
        return self._ne_success_rates(self._win_ne_reg)

    @property
    def ne_pdu_sr(self) -> dict[str, float]:
        """per-SMF 实例 PDU 会话 SR(实时)。"""
        return self._ne_success_rates(self._win_ne_pdu)

    # ------------------------------------------------------------------
    # 运行时遥测(供 Agent / 策略规划器消费;不含任何真值泄漏)
    # ------------------------------------------------------------------
    def traffic_class_stats(self, window: int = 300) -> dict:
        """CHR 失败 × UE 绑定 → 失败类别归因(sst/dnn/device_type/gNB)。

        失败份额来自 CHR 失败记录;"基线份额"取绑定分布(健康 CHR 仅 3% 采样,
        不能当分母)。主导类别 = 失败份额 > 0.5 且相对基线放大 > 1.5 且失败数 ≥ 20。
        """
        recs = list(self._chr_buffer)[-window:]
        fails = [r for r in recs if r.get("outcome") == "failure"]
        by_ue = {b.ue_id: b for b in self.bindings}
        total = len(fails)

        def _attr_buckets(attr_fn) -> list[dict]:
            counts: dict[str, int] = {}
            for r in fails:
                b = by_ue.get(r.get("ue_id", ""))
                key = attr_fn(b) if b else "?"
                counts[key] = counts.get(key, 0) + 1
            base: dict[str, int] = {}
            support: dict[str, int] = {}
            for b in self.bindings:
                k = attr_fn(b)
                base[k] = base.get(k, 0) + 1
                if b.supports_backoff:
                    support[k] = support.get(k, 0) + 1
            out = []
            for key, n in sorted(counts.items(), key=lambda kv: -kv[1]):
                base_share = base.get(key, 0) / max(1, len(self.bindings))
                out.append({
                    "key": key, "fails": n, "fail_share": round(n / max(total, 1), 3),
                    "base_share": round(base_share, 3),
                    "lift": round((n / max(total, 1)) / max(base_share, 1e-6), 2),
                    "backoff_support": round(support.get(key, 0) / max(1, base.get(key, 1)), 3),
                })
            return out

        classes = {
            "sst": _attr_buckets(lambda b: f"sst={b.sst}"),
            "dnn": _attr_buckets(lambda b: f"dnn={b.dnn}"),
            "device_type": _attr_buckets(lambda b: b.device_type),
            "gNB": _attr_buckets(lambda b: b.ne.get("gNB", "?")),
        }
        dominant = None
        if total >= 20:
            for dim, buckets in classes.items():
                top = buckets[0]
                # 主导判据:失败份额过半,**且高于该类别基线占比 + 0.1**
                # (多数类场景 lift 天然有界,直接用「份额−基线差值」;
                #  可区分「激增类别」与「按基线分布的普通故障」)。
                threshold = max(0.5, top["base_share"] + 0.1)
                if top["fail_share"] > threshold:
                    flt_key = {"sst": "sst", "dnn": "dnn", "device_type": "device_type",
                               "gNB": "gNB"}[dim]
                    raw = top["key"].split("=", 1)[1] if "=" in top["key"] else top["key"]
                    val = int(raw) if flt_key == "sst" else raw
                    dominant = {
                        "dim": dim, "key": top["key"], "flt": {flt_key: val},
                        "fail_share": top["fail_share"], "lift": top["lift"],
                        "base_share": top["base_share"],
                        "backoff_support": top.get("backoff_support", 1.0),
                    }
                    break
        return {"fail_total": total, "classes": classes, "dominant": dominant}

    def load_reduction_hint(self, target_cpu: float = 75.0) -> dict[str, float]:
        """各准入层要把「进入网络的消息量」削减多少才能把 CPU 压回目标线。

        ratio = (virtual_cpu - target) / (virtual_cpu - base):按线性负载模型反解。
        virtual_cpu 用**未截断**的负载投影(base + coeff×touches,可超 100)——
        实测 CPU 在 100% 饱和后不再增长,直接用会严重低估所需削减量。
        下游 NF(UDM/PCF…)过载同样由上游 AMF/SMF 准入消化(必经入口)。
        """
        def _worst_virtual(ne_type: NEType) -> float:
            worst = 0.0
            for n in self.topology.get_elements_by_type(ne_type):
                avg_touch = sum(w.get(n.id, 0) for w in self._win_touch) / max(1, len(self._win_touch))
                worst = max(worst, _BASE_CPU[ne_type.value] + _CPU_PER_TOUCH[ne_type.value] * avg_touch)
            return worst

        ingress_need = 0.0
        for ne_type in (NEType.AMF, NEType.SMF, NEType.UDM, NEType.PCF, NEType.AUSF):
            virtual = _worst_virtual(ne_type)
            base = max(_BASE_CPU[ne_type.value], 1.0)
            if virtual > target_cpu:
                ingress_need = max(ingress_need, (virtual - target_cpu) / max(virtual - base, 1e-6))
        return {
            "AMF": round(min(ingress_need, 0.95), 3),
            "SMF": round(min(ingress_need, 0.95), 3),
        }

    def active_flow_controls(self) -> list[dict]:
        """当前生效的 flow_control 策略(规划器做轮次叠加折算用)。"""
        return [
            {"layer": p.layer, "ratio": p.ratio, "flt": dict(p.flt)}
            for p in self._policies if p.kind == "flow_control"
        ]

    def runtime_context(self) -> dict:
        """Agent 可见的运行时遥测(CPU / 到达率 / 失败类别归因 / 准入提示)。"""
        win = list(self._win_reg)[-6:]
        reg_arr = sum(r for r, _ in win) / max(1, len(win))
        win_p = list(self._win_pdu)[-6:]
        pdu_arr = sum(r for r, _ in win_p) / max(1, len(win_p))
        return {
            "ne_cpu": dict(self._ne_cpu),
            "arrivals_per_s": {"reg": round(reg_arr, 1), "pdu": round(pdu_arr, 1)},
            "traffic_class_stats": self.traffic_class_stats(),
            "load_reduction_hint": self.load_reduction_hint(),
        }

    def snapshot_for_agent(self) -> dict:
        """组装 Agent CaseData 材料(KPI/CHR/拓扑/真值 + 运行时遥测)。

        link KPI 取最近 ~6 tick 的稳定(SR 已按滚动窗口聚合,非单 tick 抖动)行,
        兼顾 anomaly_ratio 不被过度稀释与时序特征;session 级保留全部。
        """
        ground_truth = {"fault_elements": [], "fault_links": [], "fault_classes": []}
        if self.fault:
            ground_truth["fault_elements"] = sorted(self.fault.affected_ne_ids or [])
            if self.fault.surge_filter:
                ground_truth["fault_classes"] = [dict(self.fault.surge_filter)]
        return {
            "kpi_rows": list(self._kpi_link)[-90:] + list(self._kpi_trace),
            "chr_records": list(self._chr_buffer),
            "topology_text": render_topo_text(self.topology),
            "process_text": _PROCESS_TEXT,
            "ground_truth": ground_truth,
            "runtime_context": self.runtime_context(),
        }

    def _materialize_hops(self, proc_name: str, binding: UeBinding) -> list[tuple[str, str, str]]:
        """按 UE 绑定把流程模板的 (src_type,dst_type) 替换为实例 ID。"""
        proc_def = PROCESS_DEFINITIONS.get(proc_name)
        if proc_def is None:
            return []
        out: list[tuple[str, str, str]] = []
        for hop_idx, (src_type, dst_type) in enumerate(proc_def["hops"]):
            src_id = binding.ue_id if src_type == "UE" else binding.ne.get(src_type, src_type)
            dst_id = binding.ue_id if dst_type == "UE" else binding.ne.get(dst_type, dst_type)
            out.append((src_id, dst_id, proc_def["messages"][hop_idx]))
        return out


_PROCESS_TEXT = (
    "Process: PDU_Session_Establishment / Registration\n"
    "Flow(PDU): UE -> gNB -> AMF -> SMF -> UDM -> SMF -> PCF -> SMF -> UPF -> SMF -> AMF -> gNB -> UE\n"
    "Flow(Reg): UE -> gNB -> AMF -> AUSF -> UDM -> AUSF -> AMF -> UDM -> AMF -> gNB -> UE\n"
)
