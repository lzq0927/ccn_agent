// ============================================================================
// guide/steps —— 引导式舞台的步骤数据模型
//   把 director 的 8 相位映射成 8 个「引导圆圈」,并为关键相位派生:
//   · 相位1 数据采集:从哪些网元采集什么数据(箭头源)
//   · 相位5 执行恢复:策略下发到哪些网元(箭头目标)
//   · 各相位的解说文案(供 GuideCallout / 鼠标指引弹窗用)
//   所有坐标在拓扑 viewBox(1040×646)内,与 DigitalTwin 共用。
// ============================================================================

import type { NetworkGraph } from "../data/network";
import type { Scenario } from "../data/types";
import type { StoryState } from "../story/types";
import { PHASES } from "../theme";

/** 智能体「操作枢纽」—— 采集相位数据汇入此点,恢复相位策略从此点下发。
 *  选在拓扑网格中央上方空区(NRF 行之下、主网格之上),避开节点与注册线。 */
export const HUB = { x: 470, y: 172 };

/** 拓扑画布尺寸(与 network.ts 一致) */
export const GUIDE_VIEW = { w: 1040, h: 646 };

/** 引导圆圈静态定义(8 步 = 8 相位) */
export interface GuideStepDef {
  n: number; // 1..8
  phase: number; // 0..7
  cn: string;
  en: string;
  short: string; // 圆圈下方短标签
  agent: string; // 当前主 Agent
}
export const GUIDE_STEPS: GuideStepDef[] = PHASES.map((p, i) => ({
  n: i + 1,
  phase: i,
  cn: p.cn,
  en: p.en,
  short: shortLabel(i),
  agent: agentOf(i),
}));

function shortLabel(phase: number): string {
  return ["稳态", "采集", "检测", "匹配", "推理", "恢复", "验证", "评估"][phase];
}
function agentOf(phase: number): string {
  if (phase === 1) return "Agent 1 · 数据采集";
  if (phase >= 2 && phase <= 5) return "Agent 2 · 故障感知";
  if (phase === 7) return "Agent 3 · 评估优化";
  return "待命";
}

/** 采集的数据类型(逐 NE 类型)— 回答「从哪些网元采集什么数据」 */
const COLLECT_BY_TYPE: Record<string, { data: string; cat: string }> = {
  gNB: { data: "无线 KPI · 切换成功率", cat: "无线" },
  AMF: { data: "注册成功率 · NAS 信令", cat: "接入" },
  SMF: { data: "PDU 会话成功率 · N11", cat: "会话" },
  UPF: { data: "用户面流量 · UFDR 溯源", cat: "用户面" },
  UDM: { data: "数据访问时延", cat: "数据" },
  AUSF: { data: "鉴权成功率", cat: "鉴权" },
  PCF: { data: "策略决策时延", cat: "策略" },
  NRF: { data: "服务注册心跳", cat: "仓储" },
  NSSF: { data: "切片选择统计", cat: "切片" },
};

export interface CollectionSource {
  id: string;
  type: string;
  x: number;
  y: number;
  data: string; // 采集了什么
  cat: string; // 类别(配色/分组)
}

/** 相位1 采集源:9 类网元各取一个代表实例,箭头从代表节点汇向 HUB。 */
export function collectionSources(graph: NetworkGraph | undefined): CollectionSource[] {
  const g = graph;
  if (!g) return [];
  const seen = new Set<string>();
  const out: CollectionSource[] = [];
  // 按类型顺序取首个实例(gNB→AMF→…→NSSF),保证稳定的 9 条采集线
  for (const type of ["gNB", "AMF", "SMF", "UPF", "UDM", "AUSF", "PCF", "NRF", "NSSF"]) {
    const node = g.nodes.find((n) => n.type === type);
    if (!node) continue;
    if (seen.has(type)) continue;
    seen.add(type);
    const m = COLLECT_BY_TYPE[type] ?? { data: "遥测 KPI", cat: type };
    out.push({ id: node.id, type, x: node.x, y: node.y, data: m.data, cat: m.cat });
  }
  return out;
}

/** 恢复下发目标(相位5)— 回答「策略下发到什么网元」。
 *  依据场景的 isolation(隔离+接管)/ flowControl(流控锚点)/ recoveryPlan(分层并行)派生。 */
export interface DispatchTarget {
  id: string; // 目标 NE id(或 "UE" 代表用户侧)
  label: string; // 显示名
  x: number;
  y: number;
  policy: string; // 下发了什么策略
  kind: "isolate" | "failover" | "flowcontrol" | "notify";
  color: string;
}

const KIND_COLOR: Record<DispatchTarget["kind"], string> = {
  isolate: "#ef4444",
  failover: "#22c55e",
  flowcontrol: "#a78bfa",
  notify: "#f59e0b",
};

export function dispatchTargets(
  scenario: Scenario,
  state: StoryState,
  graph: NetworkGraph | undefined,
): DispatchTarget[] {
  const g = graph;
  const pos = (id: string): { x: number; y: number } | null => {
    const n = g?.nodeById[id];
    return n ? { x: n.x, y: n.y } : null;
  };
  const out: DispatchTarget[] = [];

  // 1) 隔离 + 接管(isolation:场景 A/B 等)
  if (scenario.isolation) {
    const iso = scenario.isolation;
    const p = pos(iso.isolateNe);
    if (p) out.push({ id: iso.isolateNe, label: iso.isolateNe, x: p.x, y: p.y, policy: "隔离摘除负载", kind: "isolate", color: KIND_COLOR.isolate });
    for (const f of iso.failoverTo) {
      const pf = pos(f);
      if (pf) out.push({ id: f, label: f, x: pf.x, y: pf.y, policy: "接管流量", kind: "failover", color: KIND_COLOR.failover });
    }
  }

  // 2) 流控策略(flowControl:场景 D)— 锚点 NE(AMF/SMF)+ 措施
  if (scenario.flowControl) {
    const fc = scenario.flowControl;
    const anchor = pos(fc.anchorNe);
    if (anchor && !out.some((o) => o.id === fc.anchorNe)) {
      out.push({
        id: fc.anchorNe,
        label: fc.anchorNe,
        x: anchor.x,
        y: anchor.y,
        policy: fc.kind === "net_admission" ? "限 NSSAI / APN 接纳" : "Registration Reject + back-off",
        kind: "flowcontrol",
        color: KIND_COLOR.flowcontrol,
      });
    }
    // 网络侧限流场景(E):SMF 也下发了 APN 限流
    if (fc.kind === "net_admission") {
      const smf = g?.nodes.find((n) => n.type === "SMF");
      if (smf && !out.some((o) => o.id === smf.id)) {
        out.push({ id: smf.id, label: smf.id, x: smf.x, y: smf.y, policy: "限物联 APN/DNN 接纳", kind: "flowcontrol", color: KIND_COLOR.flowcontrol });
      }
    }
  }

  // 3) UE 侧 back-off:策略下发到用户终端 —— D 场景 UE Timer 由 AMF/SMF 返回,不单独指 UE
  const hasUeBackoff =
    scenario.stormMetrics?.udmCpu == null && (
      scenario.flowControl?.kind === "ue_backoff" ||
      (scenario.recoveryPlan && scenario.recoveryPlan.strategies.some((s) => s.layer === "UE"))
    );
  if (hasUeBackoff) {
    // UE 簇在拓扑最左侧(x≈26,y≈250/392/540),取中间簇代表用户侧
    out.push({ id: "UE", label: "物联网终端(UE)", x: 30, y: 392, policy: "back-off timer 抑制反复上线", kind: "notify", color: KIND_COLOR.notify });
  }

  // 4) D:三层并行(UE back-off + AMF NSSAI + SMF DNN)—— 目标 = 该类型中过载的 NE(无则取代表)
  if (scenario.recoveryPlan) {
    for (const s of scenario.recoveryPlan.strategies) {
      if (s.layer === "UE") continue; // 已由 UE back-off 覆盖
      const type = s.layer === "AMF" ? "AMF" : "SMF";
      const overloaded = (g?.nodes ?? []).filter((n) => n.type === type && scenario.fault.elements.includes(n.id));
      const nodes = overloaded.length ? overloaded : (g?.nodes ?? []).filter((n) => n.type === type).slice(0, 1);
      for (const node of nodes) {
        if (out.some((o) => o.id === node.id)) continue;
        out.push({
          id: node.id,
          label: node.id,
          x: node.x,
          y: node.y,
          policy: s.layer === "AMF" ? `限物联 NSSAI 接纳 ${valueFor(scenario, state, s.layer)}%` : `限物联 DNN 接纳 ${valueFor(scenario, state, s.layer)}%`,
          kind: "flowcontrol",
          color: KIND_COLOR.flowcontrol,
        });
      }
    }
  }

  // 5) C 场景(无线群体异常):策略 = 通知 gNB_2 下 UE 换路(网络无法隔离 gNB)
  if (!scenario.isolation && !scenario.flowControl && !scenario.recoveryPlan && scenario.userFault) {
    for (const gn of scenario.userFault.gnbs) {
      const p = pos(gn);
      if (p) out.push({ id: gn, label: gn, x: p.x, y: p.y, policy: "通知受影响 UE 换路/重选", kind: "notify", color: KIND_COLOR.notify });
    }
  }

  return out;
}

/** D 场景各层策略的当前值(轮1 initialValue / 轮2 r2Values) */
function valueFor(scenario: Scenario, state: StoryState, layer: "AMF" | "SMF"): number {
  if (!scenario.recoveryPlan) return 0;
  if (state.round === 2) {
    const v = scenario.recoveryPlan.rounds.r2Values.find((x) => x.layer === layer);
    return v ? v.value : 0;
  }
  const s = scenario.recoveryPlan.strategies.find((x) => x.layer === layer);
  return s ? s.initialValue : 0;
}

/** 当前步骤的解说文案(供 GuideCallout)—— 讲清「此刻在干什么、为什么」 */
export interface GuideCallout {
  step: number;
  title: string;
  body: string;
  bullets: string[];
}

export function guideCallout(scenario: Scenario, state: StoryState): GuideCallout {
  const ph = state.phaseIndex;
  const step = ph + 1;
  const r = state.round;
  const rn = r === 2 ? " · 第②轮" : "";
  switch (ph) {
    case 0:
      return {
        step, title: "网络稳态运行", body: "5GC 全网健康,智能体逐链路监测待命。点击右上方圆圈可跳转任意步骤。",
        bullets: ["整网成功率 99.8%", "9 类网元 · 21 实例在线", "多维动态检测:KPI / 告警 / CHR 任一异常即触发"],
      };
    case 1:
      return {
        step, title: `Agent 1 · 现网数据采集${rn}`, body: "从全网 9 类网元采集遥测:逐链路 KPI 成功率时序、CHR 原因值分布、3GPP 信令日志、容器 CPU,经 LLM 多维校验后入库。",
        bullets: ["KPI 逐链路成功率", "CHR 原因值(降噪→聚类)", "3GPP 信令 + 容器 CPU", "LLM 5 维校验闭环"],
      };
    case 2:
      return {
        step, title: "异常检测", body: "KPI / CHR 双线并行检测,任一链路成功率跌破 99.5% 即触发根因分析;整网聚合对微损近乎无感,逐链路全面初筛方见异常。",
        bullets: ["KPI 时空求解", "CHR 降噪聚类", "异常全面初筛", "CPU 过载告警(D)"],
      };
    case 3:
      return {
        step, title: "策略匹配 · 置信度路由", body: "多维特征加权评分,按置信度分流三路径:>0.7 确定性工作流 / 0.3–0.7 技能引导 / ≤0.3 自主探索。",
        bullets: [`${scenario.cn}`, `置信度 ${scenario.confidence.score.toFixed(2)} → ${routeCn(scenario.confidence.route)}`, "特征:模式强度/严重度/时空清晰度"],
      };
    case 4:
      return {
        step, title: `Agent 2 · 根因推理${rn}`, body: "Agent Loop 多维数据综合判断,推理链逐步收敛,防误报与漏报。",
        bullets: [`${scenario.objective ?? scenario.tagline}`.slice(0, 30) + "…", `已揭示 ${state.reasoningSteps.length}/${state.reasoningTotal} 步`, ...(state.loopBackKind ? [`⚠ 评估未通过 · loop 回 Agent1 补采`] : [])],
      };
    case 5: {
      const targets = dispatchTargets(scenario, state, scenario.realGraph);
      return {
        step, title: `执行恢复 · 策略下发${rn}`, body: "Agent 2 决策后,将恢复策略下发到目标网元:隔离故障实例 / 流量切换接管 / 流控限流 / 用户侧 back-off。",
        bullets: targets.slice(0, 4).map((t) => `${t.label} · ${t.policy}`),
      };
    }
    case 6:
      return {
        step, title: "网络恢复 · 闭环验证", body: "恢复动作生效后,成功率回升至阈值以上,闭环验证通过,网络自愈完成。",
        bullets: ["成功率回升 ≥ 99.5%", "隔离实例已摘除", "流量已切健康实例"],
      };
    default:
      return {
        step, title: "Agent 3 · 评估优化", body: "比对诊断结果与真值(P/R/F1),分析推理链质量,沉淀 Skill,优化建议回流 Agent 1 / Agent 2,形成闭环。",
        bullets: ["精确匹配 P/R/F1", "推理链质析", `Skill 沉淀:${scenario.skillEvolution?.skillCn ?? "—"}`],
      };
  }
}

function routeCn(r: string): string {
  return r === "workflow" ? "确定性工作流" : r === "guided" ? "技能引导 Loop" : r === "autonomous" ? "自主探索 Loop" : r;
}

export function stepOf(phase: number): GuideStepDef {
  return GUIDE_STEPS[phase] ?? GUIDE_STEPS[0];
}
