"""policy_planner: 通用恢复策略规划器 —— 从「诊断结果 + 网络遥测」推导策略。

取代旧 ``policy_resolver``(读 per-scenario 恢复配方 ``recovery_actions`` 的剧本式
实现)。本模块**不含任何场景分支**:同样的规则适用于任何故障、任何拓扑。

决策规则(全部由 DiagnosisResult + 引擎公开遥测驱动):

1. **业务激增/过载类**(fault_mode=business、fault_type∈{path_session,path_trace,
   path_link,all_type_ne,multi_type_ne},或遥测显示核心 NF CPU 过载):
   - 定位激增类别:诊断给出的 ``traffic_filter``,或引擎失败类别归因的主导类别;
   - 在入口层(AMF 管注册 / SMF 管会话,均为到下游 NF 流量的必经之路)按引擎
     ``load_reduction_hint`` 的实测 CPU 差值反解 ratio,下发准入限流;
   - 诊断指向用户侧(fault_elements 含 gNB / traffic_filter 存在)时,同时对匹配
     类别终端下发 back-off(引擎按终端支持率折减——不支持者继续冲击,如 iPhone)。
   - 轮次 r>1:按**当前** CPU 与目标线的残余差值重算并叠加更强策略(反馈控制),
     而非换剧本。
2. **网元/链路类**(诊断给出具体 NE 且非过载态):
   - 核心网 NF(AMF/SMF/UPF/PCF/UDM/AUSF/NRF/NSSF)且存在健康同型实例:
     隔离 + 会话重选(只隔离不重选会让绑定其上的会话全部失败——策略不足会真实
     表现为不恢复,由下一轮补足);
   - gNB(接入侧)或 fault_mode=business 的用户侧故障:仅用户重选邻区,不隔离网元。
3. **无诊断/空诊断**:遥测兜底(CPU 过载→准入限流;退化链路→聚合 top NE 处置)。
   误诊时策略会打错对象 → 网络不恢复 → 诚实进入下一轮或最终评估失败。

输出 ``PlannedAction``:引擎 ``PolicyAction`` + 通用生成的展示文案(cn/en/layer)。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from agents.simulation.realtime_engine import PolicyAction

if TYPE_CHECKING:
    from simulator.models import Topology

    from agents.shared.models import DiagnosisResult

logger = logging.getLogger(__name__)

# 网元类故障:核心网 NF 与接入侧的处置差异(通用按类型,不按场景)
_CORE_NF_TYPES = {"AMF", "SMF", "UPF", "PCF", "UDM", "AUSF", "NRF", "NSSF"}
# 过载/业务类 fault_type(与 simulator.models.FaultPointType 对应的字符串值)
_OVERLOAD_TYPES = {"path_session", "path_trace", "path_link", "all_type_ne", "multi_type_ne"}
_CPU_OVERLOAD_LINE = 80.0
# ratio 下限/上限:过小无意义,过大等于关断(留给诊断持续错误时的极端轮次)
_RATIO_MIN, _RATIO_MAX = 0.05, 0.95
# 每轮反馈控制的增益:按残余差值 × 增益抬升 ratio(r1 起步保守,未收敛则逐轮加严)
_ROUND_GAIN = {1: 0.85, 2: 1.0, 3: 1.15}


@dataclass
class PlannedAction:
    policy: PolicyAction
    id: str
    cn: str
    en: str
    layer: str
    rationale: str = ""          # 为什么下发这条(展示/落盘用)


@dataclass
class PlanContext:
    """规划器可见的网络遥测(引擎公开视图,不含真值)。"""
    topology: "Topology"
    ne_cpu: dict[str, float] = field(default_factory=dict)
    ne_pdu_sr: dict[str, float] = field(default_factory=dict)
    ne_reg_sr: dict[str, float] = field(default_factory=dict)
    load_hint: dict[str, float] = field(default_factory=dict)      # {"AMF": r, "SMF": r}
    class_stats: Optional[dict] = None                            # traffic_class_stats()
    isolated_by_policy: set[str] = field(default_factory=set)     # 已被策略隔离的 NE
    active_flow_controls: list[dict] = field(default_factory=list)  # 引擎已生效的流控


def plan_recovery_actions(
    diagnosis: Optional["DiagnosisResult"],
    ctx: PlanContext,
    round_no: int = 1,
) -> list[PlannedAction]:
    """把诊断翻译成通用恢复策略。纯函数、无场景分支。"""
    actions: list[PlannedAction] = []
    diag_elements = [
        ne for ne in (getattr(diagnosis, "fault_elements", None) or [])
        if ne in ctx.topology.elements
    ]
    fault_mode = (getattr(diagnosis, "fault_mode", None) or "").lower()
    fault_type = (getattr(diagnosis, "fault_type", None) or "").lower()
    traffic_filter = getattr(diagnosis, "traffic_filter", None) or None

    overloaded = _overloaded_nes(ctx)
    gain = _ROUND_GAIN.get(round_no, 1.15)

    # ---- 1) 过载/业务激增:入口准入 + 终端 back-off ----
    if overloaded or fault_type in _OVERLOAD_TYPES or (fault_mode == "business" and not diag_elements):
        actions.extend(_plan_admission(diag_elements, traffic_filter, ctx, gain, round_no))

    # ---- 2) 具体网元:核心 NF 隔离+重选;接入侧/用户侧仅重选 ----
    # 业务激增/路径类诊断:过载 NF 是受害者不是根因,隔离/重选只会减少容量、
    # 还可能把绑定集中到单实例造成新瓶颈 —— 一律不做 NE 处置,靠入口准入消化。
    if fault_type not in _OVERLOAD_TYPES:
        for ne_id in diag_elements:
            actions.extend(_plan_ne_recovery(ne_id, fault_mode, ctx, round_no))

    # ---- 3) 空诊断兜底:遥测驱动 ----
    if not actions:
        actions.extend(_plan_from_telemetry(ctx, gain, round_no))

    # 去重(同 id 只留一条;多轮叠加由引擎 max-ratio 语义处理)
    seen: set[str] = set()
    unique: list[PlannedAction] = []
    for a in actions:
        if a.id not in seen:
            seen.add(a.id)
            unique.append(a)
    logger.info("policy_planner round%d: %d actions (diag=%s type=%s mode=%s)",
                round_no, len(unique), diag_elements, fault_type, fault_mode)
    return unique


# ---------------------------------------------------------------------------
# 内部规则
# ---------------------------------------------------------------------------
def _overloaded_nes(ctx: PlanContext) -> set[str]:
    return {
        ne_id for ne_id, cpu in ctx.ne_cpu.items()
        if cpu >= _CPU_OVERLOAD_LINE and not ne_id.startswith("gNB")
    }


def _dominant_filter(ctx: PlanContext) -> Optional[dict]:
    stats = ctx.class_stats or {}
    dom = stats.get("dominant")
    return dict(dom["flt"]) if dom else None


def _class_label(flt: Optional[dict]) -> str:
    if not flt:
        return "全部类别"
    return "·".join(f"{k}={v}" for k, v in flt.items())


def _ratio_from_hint(hint: float, gain: float, class_share: float) -> float:
    """[已弃用,保留兼容] 首轮 ratio:实测需要的总削减 ÷ 类别占比 × 增益。"""
    if hint <= 0:
        return 0.0
    share = class_share if 0 < class_share < 1.0 else 1.0
    r = hint / share * gain
    return max(_RATIO_MIN, min(_RATIO_MAX, r))


def _class_share(ctx: PlanContext, flt: Optional[dict]) -> float:
    """匹配 flt 的类别在绑定中的占比(无类别归因数据时按全量估计)。"""
    stats = ctx.class_stats or {}
    classes = (stats.get("classes") or {}).get("sst") or []
    if not flt or not classes:
        return 1.0
    key = f"sst={flt['sst']}" if "sst" in flt else ""
    for c in classes:
        if c.get("key") == key:
            return float(c.get("base_share", 1.0))
    return 1.0


def _applied_ratio(ctx: PlanContext, layer: str) -> float:
    """引擎在该层已生效的最大准入抑制比(轮次叠加折算用)。"""
    return max(
        (fc.get("ratio", 0.0) for fc in ctx.active_flow_controls if fc.get("layer") == layer),
        default=0.0,
    )


def _escalated_ratio(applied: float, residual_need: float, gain: float, share: float) -> float:
    """把「当前到目标的残余削减需求」折算成叠加后的总 ratio。

    引擎多轮策略取 max ratio(非乘法),而负载削减是乘法的:
    总削减 = 1-(1-applied)×(1-residual) → 新下发的 ratio 必须是**累计总 ratio**。
    类别过滤时按类别占比放大(总削减 = 类别占比 × 类别内 ρ)。
    """
    total_need = 1.0 - (1.0 - applied) * (1.0 - residual_need * gain)
    eff_share = share if 0 < share < 1.0 else 1.0
    r = total_need / eff_share
    return max(_RATIO_MIN, min(_RATIO_MAX, r))


def _plan_admission(
    diag_elements: list[str],
    traffic_filter: Optional[dict],
    ctx: PlanContext,
    gain: float,
    round_no: int,
) -> list[PlannedAction]:
    """入口准入限流(AMF/SMF)+ 终端 back-off。ratio 来自引擎实测 CPU 差值。"""
    out: list[PlannedAction] = []
    flt = traffic_filter or _dominant_filter(ctx)
    hint_amf = float((ctx.load_hint or {}).get("AMF", 0.0))
    hint_smf = float((ctx.load_hint or {}).get("SMF", 0.0))
    if hint_amf <= 0 and hint_smf <= 0:
        # 遥测无过载但诊断坚持业务类故障:按经验中档起步(反馈轮会修正)
        hint_amf = hint_smf = 0.35

    share = _class_share(ctx, flt)
    label = _class_label(flt)

    # 终端 back-off:诊断指向用户侧(traffic_filter / gNB 元素)时下发;
    # 引擎按终端支持率折减(不支持者继续冲击 → 可能真实不足 → 下一轮补网络侧)
    user_side = bool(flt) or any(ne.startswith("gNB") for ne in diag_elements)
    if user_side and round_no <= 2:
        applied = _applied_ratio(ctx, "UE")
        ratio = _escalated_ratio(applied, max(hint_amf, hint_smf), gain, share)
        out.append(PlannedAction(
            policy=PolicyAction(kind="flow_control", layer="UE", ratio=ratio, flt=dict(flt or {})),
            id=f"ue_backoff_r{round_no}",
            cn=f"受影响终端 back-off(T3346/T3396)·{label}", en=f"UE BACKOFF · {label}",
            layer="UE",
            rationale=f"按实测负载差值 {max(hint_amf, hint_smf):.0%} 推导抑制比"
                      f"(已施加 {applied:.0%} 叠加;终端支持率折减)",
        ))
    # AMF / SMF 入口准入(网络侧,对匹配类别全效)
    if hint_amf > 0:
        applied = _applied_ratio(ctx, "AMF")
        ratio = _escalated_ratio(applied, hint_amf, gain, share)
        out.append(PlannedAction(
            policy=PolicyAction(kind="flow_control", layer="AMF", ratio=ratio, flt=dict(flt or {})),
            id=f"amf_admission_r{round_no}",
            cn=f"AMF 准入限流 {label} ρ={ratio:.0%}", en=f"AMF ADMISSION {label} ρ={ratio:.0%}",
            layer="AMF",
            rationale=f"AMF 实测需削减 {hint_amf:.0%}(已施加 {applied:.0%} 叠加;"
                      f"类别占比 {share:.0%} → 类别内 ρ)",
        ))
    if hint_smf > 0:
        applied = _applied_ratio(ctx, "SMF")
        ratio = _escalated_ratio(applied, hint_smf, gain, share)
        out.append(PlannedAction(
            policy=PolicyAction(kind="flow_control", layer="SMF", ratio=ratio, flt=dict(flt or {})),
            id=f"smf_admission_r{round_no}",
            cn=f"SMF 准入限流 {label} ρ={ratio:.0%}", en=f"SMF ADMISSION {label} ρ={ratio:.0%}",
            layer="SMF",
            rationale=f"SMF 实测需削减 {hint_smf:.0%}(已施加 {applied:.0%} 叠加;"
                      f"类别占比 {share:.0%} → 类别内 ρ)",
        ))
    return out


def _plan_ne_recovery(
    ne_id: str, fault_mode: str, ctx: PlanContext, round_no: int,
) -> list[PlannedAction]:
    """单个诊断网元的处置:核心 NF 隔离+重选;gNB/业务侧仅用户重选。"""
    out: list[PlannedAction] = []
    ne = ctx.topology.elements.get(ne_id)
    if ne is None:
        return out
    ne_type = ne.ne_type.value
    peers = [n.id for n in ctx.topology.get_elements_by_type(ne.ne_type) if n.id != ne_id]

    if ne_type == "gNB" or fault_mode == "business":
        out.append(PlannedAction(
            policy=PolicyAction(kind="reroute", from_ne_id=ne_id),
            id=f"reroute_{ne_id}_r{round_no}",
            cn=f"通知 {ne_id} 下受影响终端重选邻区", en=f"USER REROUTE FROM {ne_id}",
            layer="UE",
            rationale=f"{ne_id} 为接入侧/用户侧根因,网元健康,仅用户重选",
        ))
        return out

    if ne_type in _CORE_NF_TYPES:
        out.append(PlannedAction(
            policy=PolicyAction(kind="reroute", from_ne_id=ne_id),
            id=f"reroute_{ne_id}_r{round_no}",
            cn=f"{ne_id} 承载会话重选至健康同型实例", en=f"REROUTE FROM {ne_id}",
            layer=ne_type,
            rationale=f"隔离前先重选,保证 {ne_id} 上会话有健康接管实例",
        ))
        if peers and ne_id not in ctx.isolated_by_policy:
            out.append(PlannedAction(
                policy=PolicyAction(kind="isolate", ne_id=ne_id),
                id=f"iso_{ne_id}_r{round_no}",
                cn=f"隔离 {ne_id}", en=f"ISOLATE {ne_id}",
                layer=ne_type,
                rationale=f"诊断定位 {ne_id} 为根因,存在同型健康实例({'/'.join(peers)})可接管",
            ))
    return out


def _plan_from_telemetry(ctx: PlanContext, gain: float, round_no: int) -> list[PlannedAction]:
    """空诊断兜底:过载→入口准入;退化链路→per-NE SR 最低的核心 NF 处置。"""
    out: list[PlannedAction] = []
    if _overloaded_nes(ctx):
        out.extend(_plan_admission([], None, ctx, gain, round_no))
        return out
    # 无过载、无诊断:按 per-NE SR 最低的核心 NF 谨慎处置(仅当显著低于同类)
    by_type: dict[str, list[tuple[str, float]]] = {}
    for ne_id, sr in {**ctx.ne_reg_sr, **ctx.ne_pdu_sr}.items():
        ne = ctx.topology.elements.get(ne_id)
        if ne is None or ne.ne_type.value not in _CORE_NF_TYPES:
            continue
        by_type.setdefault(ne.ne_type.value, []).append((ne_id, sr))
    for ne_type, items in by_type.items():
        if len(items) < 2:
            continue
        items.sort(key=lambda x: x[1])
        worst, best = items[0], items[-1]
        if worst[1] < min(0.985, best[1] - 0.01):
            out.extend(_plan_ne_recovery(worst[0], "link", ctx, round_no))
            break
    return out


def build_plan_context(engine: Any, isolated_by_policy: Optional[set[str]] = None) -> PlanContext:
    """从 RealtimeEngine 公开遥测构造规划上下文(不读任何真值字段)。"""
    rc = engine.runtime_context()
    return PlanContext(
        topology=engine.topology,
        ne_cpu=dict(rc.get("ne_cpu", {})),
        ne_pdu_sr=dict(engine.ne_pdu_sr),
        ne_reg_sr=dict(engine.ne_reg_sr),
        load_hint=dict(rc.get("load_reduction_hint", {})),
        class_stats=rc.get("traffic_class_stats"),
        isolated_by_policy=set(isolated_by_policy or set()),
        active_flow_controls=list(engine.active_flow_controls()),
    )
