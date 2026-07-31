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
from simulator.models import FaultConfig, FaultPointType, NEType, Topology
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

        # 滚动计数(每 tick 一格)
        self._win_reg: deque[tuple[int, int]] = deque(maxlen=_ROLLING_WINDOW)  # (req, succ)
        self._win_pdu: deque[tuple[int, int]] = deque(maxlen=_ROLLING_WINDOW)
        self._win_touch: deque[dict[str, int]] = deque(maxlen=_ROLLING_WINDOW)
        # 每有向链路逐 tick 的 (att,succ) 滚动窗口 → 稳定的局向 KPI(避免单 tick 小样本抖动)
        self._win_link: deque[dict[tuple[str, str], list[int]]] = deque(maxlen=_ROLLING_WINDOW)

        # 给 Agent 的累积缓冲
        self._kpi_link: deque[dict] = deque(maxlen=_KPI_BUFFER_LINK)
        self._kpi_trace: deque[dict] = deque(maxlen=_KPI_BUFFER_TRACE)
        self._chr_buffer: deque[dict] = deque(maxlen=_CHR_BUFFER)

        # 本 tick 累计
        self._tick_reg_req = self._tick_reg_succ = 0
        self._tick_pdu_req = self._tick_pdu_succ = 0
        self._tick_iot_reg = self._tick_toc_reg = 0
        self._tick_iot_sess = self._tick_toc_sess = 0
        self._tick_touch: dict[str, int] = {}
        self._tick_link: dict[tuple[str, str], list[int]] = {}  # (s,d)->[att,succ]
        self._tick_chr: list[dict] = []

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

        # 1) 生成到达:注册 + PDU 各按 λ(受故障/策略调制)
        reg_n, pdu_n, iot_reg, toc_reg, iot_sess, toc_sess = self._arrivals_for_tick()
        self._tick_iot_reg, self._tick_toc_reg = iot_reg, toc_reg
        self._tick_iot_sess, self._tick_toc_sess = iot_sess, toc_sess

        bindings = self.bindings
        for _ in range(reg_n):
            b = self._rng.choice(bindings)
            self._spawn_attempt(b, "Registration")
        for _ in range(pdu_n):
            b = self._rng.choice(bindings)
            self._spawn_attempt(b, "PDU_Session_Establishment")

        # 2) 排空事件堆:逐跳处理本 tick 内全部信令消息
        while self._heap and self._heap[0][0] < sim_t + 1:
            _, _, hop = heapq.heappop(self._heap)
            self._process_hop(hop, sim_t)

        # 3) 滚动窗口 + 快照
        self._win_reg.append((self._tick_reg_req, self._tick_reg_succ))
        self._win_pdu.append((self._tick_pdu_req, self._tick_pdu_succ))
        self._win_touch.append(dict(self._tick_touch))
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
        self._tick_touch = {}
        self._tick_link = {}
        self._tick_chr = []

    # ------------------------------------------------------------------
    # 到达模型
    # ------------------------------------------------------------------
    def _arrivals_for_tick(self) -> tuple[int, int, int, int, int, int]:
        scen = self.scenario
        base_reg = float(getattr(scen, "base_reg_lambda", 14.0)) if scen else 14.0
        base_pdu = float(getattr(scen, "base_pdu_lambda", 26.0)) if scen else 26.0
        iot_ratio = float(getattr(scen, "iot_ratio", 0.0)) if scen else 0.0

        # iot_storm 故障:物联网到达激增
        storm_mult = 1.0
        if self.fault and self.fault.fault_point_type == FaultPointType.PATH_SESSION and getattr(scen, "is_storm", False):
            storm_mult = 8.0
        # flow_control 策略:按 ratio 削减匹配到达
        reg_throttle, pdu_throttle = self._compute_throttle()

        iot_reg_lambda = base_reg * iot_ratio * storm_mult * (1 - reg_throttle)
        toc_reg_lambda = base_reg * (1 - iot_ratio) * (1 - reg_throttle)
        iot_sess_lambda = base_pdu * iot_ratio * storm_mult * (1 - pdu_throttle)
        toc_sess_lambda = base_pdu * (1 - iot_ratio) * (1 - pdu_throttle)

        iot_reg = self._poisson(iot_reg_lambda)
        toc_reg = self._poisson(toc_reg_lambda)
        iot_sess = self._poisson(iot_sess_lambda)
        toc_sess = self._poisson(toc_sess_lambda)
        return iot_reg + toc_reg, iot_sess + toc_sess, iot_reg, toc_reg, iot_sess, toc_sess

    def _compute_throttle(self) -> tuple[float, float]:
        """返回 (reg 削减比, pdu 削减比)——取最强匹配的 flow_control。

        UE back-off 同时削减注册与 PDU 到达;AMF NSSAI 削注册;SMF DNN 削 PDU。
        """
        reg_th = pdu_th = 0.0
        for p in self._policies:
            if p.kind != "flow_control":
                continue
            if p.layer == "UE":
                reg_th = max(reg_th, p.ratio)
                pdu_th = max(pdu_th, p.ratio)
            elif p.layer == "AMF":
                reg_th = max(reg_th, p.ratio)
            elif p.layer == "SMF":
                pdu_th = max(pdu_th, p.ratio)
        return reg_th, pdu_th

    def _poisson(self, lam: float) -> int:
        if lam <= 0:
            return 0
        return self._rng.randint(0, int(2 * lam)) if lam < 4 else int(self._rng.gauss(lam, lam ** 0.5 / 2))

    # ------------------------------------------------------------------
    # 事件处理:一条信令跳
    # ------------------------------------------------------------------
    def _spawn_attempt(self, binding: UeBinding, proc_name: str) -> None:
        hops = self._materialize_hops(proc_name, binding)
        if not hops:
            return
        # 请求计数:注册→AMF,PDU→SMF
        if proc_name == "Registration":
            self._tick_reg_req += 1
        else:
            self._tick_pdu_req += 1
        # 拥塞准入:负责 NF(AMF/SMF)CPU 过载时按过载程度拒绝(风暴场景的 SR 下降来源)
        nf = binding.ne.get("AMF") if proc_name == "Registration" else binding.ne.get("SMF")
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
            # 流程成功完成 → 计成功
            if proc_name == "Registration":
                self._tick_reg_succ += 1
            else:
                self._tick_pdu_succ += 1
        # 失败:流程中止(请求已计,成功不计)

    def _hop_outcome(self, src: str, dst: str, binding: UeBinding, proc_name: str) -> tuple[bool, bool]:
        """判定一跳成功/失败 + 是否命中故障(供 CHR cause code)。

        背景噪声压到极低(无线 0.0003 / SBI 0.0001),避免 10~12 跳相乘后健康流程
        成功率被错误压低;健康流程成功率 ≈ 0.998,与现网一致。
        """
        ue_id = binding.ue_id
        # UE 无线跳:背景噪声
        if src == ue_id or dst == ue_id:
            return self._rng.random() > 0.0003, False
        # 任一 NE 宕机 → 失败
        if self._ne_status.get(src) == "down" or self._ne_status.get(dst) == "down":
            return False, True
        # degraded NE(link/single_ne 故障):按 loss 丢损
        for ne_id in (src, dst):
            loss = self._ne_loss.get(ne_id)
            if loss and self._rng.random() < loss:
                return False, True
        # 背景噪声
        return self._rng.random() > 0.0001, False

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
        is_storm = fc.fault_point_type == FaultPointType.PATH_SESSION and bool(
            getattr(self.scenario, "is_storm", False)
        )
        if not is_storm:
            # 单网元 / 链路类:per-hop 丢损(degraded);极端 loss 视为 down
            for ne_id in affected:
                self._ne_loss[ne_id] = max(self._ne_loss.get(ne_id, 0.0), fc.loss_rate)
                if fc.loss_rate >= 0.5:
                    self._ne_status[ne_id] = "down"
        # iot_storm 不设 per-hop loss:靠 storm_mult 抬升到达 → AMF/SMF CPU 过载
        # → _spawn_attempt 的拥塞准入拒绝(产生适度的 SR 下降 + 拥塞 CHR,而非灾难性丢包)
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
            "link_anomalies": [
                {"src": s, "dst": d, "success_rate": round(succ / att, 4)}
                for (s, d), (att, succ) in self._tick_link.items() if succ / (att or 1) < 0.995
            ],
        }

    @property
    def ne_cpu(self) -> dict[str, float]:
        return dict(self._ne_cpu)

    def snapshot_for_agent(self) -> dict:
        """组装 Agent CaseData 材料(KPI/CHR/拓扑/真值)。

        link KPI 取最近 ~6 tick 的稳定(SR 已按滚动窗口聚合,非单 tick 抖动)行,
        兼顾 anomaly_ratio 不被过度稀释与时序特征;session 级保留全部。
        """
        ground_truth = {"fault_elements": [], "fault_links": []}
        if self.fault:
            ground_truth["fault_elements"] = sorted(self.fault.affected_ne_ids or [])
        return {
            "kpi_rows": list(self._kpi_link)[-90:] + list(self._kpi_trace),
            "chr_records": list(self._chr_buffer),
            "topology_text": render_topo_text(self.topology),
            "process_text": _PROCESS_TEXT,
            "ground_truth": ground_truth,
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
