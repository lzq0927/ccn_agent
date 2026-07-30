// ============================================================================
// llm —— 「分析」叙事数据(分相位 · 场景化 · 区分 大模型 / 规则 / 算法)
//   给右侧弹窗的分析区:不是每个相位都有大模型参与,按实际方法标注。
//   每相位可含多个「分析步」(steps),逐步揭示(随相位进度),每步可有独立 method:
//     llm  = 大模型参与(校验/根因探索/评估/报告)
//     rule = 规则引擎(阈值监测/置信度评分/恢复编排/验证)
//     algo = 算法(iFFusion 融合检测 / 均质化比较 / 故障聚合 / CHR 降噪聚类 / UFDR 溯源…)
//
//   LLM 参与模型(全场景统一):
//     · Agent1(相位1)= LLM 多维校验数据
//     · Agent2(相位2-5):A 全程算法(无 LLM);B 输出评估用 LLM;C 根因探索+输出评估用 LLM;D/E 溯源算法
//     · Agent3(相位7)= LLM 故障报告总结
//   数据派生自 Scenario,确定性,不调后端。
// ============================================================================

import type { Scenario } from "./types";
import { ROUTE_COLORS } from "../theme";
import { getExploration } from "./plan";

export type AnalysisMethod = "llm" | "rule" | "algo";

/** 单个分析步(可带独立 method,缺省继承块级 method) */
export interface AnalysisStep {
  method?: AnalysisMethod;
  label: string;
  text: string;
}

export interface LlmAnalysis {
  method: AnalysisMethod; // 块级默认 method(表头)
  title: string;
  steps: AnalysisStep[]; // 逐步揭示的分析步
  principle?: string; // 本相位应用的推理原则/算法(均质化比较/CHR 降噪/用户分群…)
  verdict?: string;
}

function neType(id: string): string {
  return id.replace(/_\d+$/, "");
}
function roleOf(type: string): string {
  switch (type) {
    case "UPF": return "用户面";
    case "SMF": return "会话管理";
    case "UDM": return "统一数据管理";
    case "AMF": return "接入与移动性";
    case "gNB": return "无线接入";
    default: return type;
  }
}

export function llmAnalysis(s: Scenario, phase: number): LlmAnalysis {
  const rootNe = s.fault.elements[0] ?? "—";
  const type = neType(rootNe);
  const route = s.confidence.route;
  const routeCn = ROUTE_COLORS[route]?.cn ?? route;
  const expl = getExploration(s.id);

  switch (phase) {
    case 0:
      return {
        method: "rule",
        title: "稳态监测规则",
        steps: [
          { label: "多维检测", text: "动态阈值 + 多维检测:逐链路 KPI、容器告警、CHR 原因值任一异常即触发。" },
          { label: "规则判定", text: "整网聚合 99.8%、CHR 分布平稳,规则判定全网健康。" },
        ],
        verdict: "规则:网络稳态 · 维持监测待命。",
      };
    case 1:
      // Agent1 · LLM 多维校验
      return {
        method: "llm",
        title: "大模型 · 多维校验",
        steps: [
          { label: "采集", text: "采集 KPI 逐链路时序 · CHR 原因值 · 3GPP 信令三路遥测。" },
          { label: "🤖 校验", method: "llm", text: "大模型多维校验 5 项通过(一致性/可观测性/拓扑/流程/标签)。" },
        ],
        verdict: "大模型:数据可信 · 可进入检测。",
      };
    case 2:
      return {
        method: "algo",
        title: "iFFusion 融合检测算法",
        steps: [
          { label: "融合检测", text: `KPI+CHR 双线融合检测:${type}(${roleOf(type)})方向链路跌破阈值。` },
          { label: "逐链路初筛", text: "整网聚合对微损无感,逐链路全面初筛方见异常。" },
        ],
        verdict: "算法:存在异常 · 进入置信度研判。",
      };
    case 3:
      return {
        method: "rule",
        title: "置信度加权评分规则",
        steps: [
          { label: "多维加权", text: `多维特征加权评分 ${s.confidence.score.toFixed(2)}(模式×0.4 + 严重×0.2 + 时空×0.3)。` },
          {
            label: "路由判定",
            text: expl.iterations.length > 0
              ? `规则路由:${routeCn},需探索 ${expl.iterations.length} 轮收敛。`
              : "规则路由:命中已知模式,确定性工作流直达。",
          },
        ],
        verdict: `规则:${expl.gateVerdict}`,
      };
    case 4:
      return phase4Analysis(s, type, rootNe);
    case 5:
      return phase5Analysis(s, rootNe, type);
    case 6:
      return {
        method: "rule",
        title: "闭环验证规则",
        steps: [
          { label: "阈值复检", text: "成功率回升至 99.8%,受影响链路回到基线。" },
          { label: "规则判定", text: "逐链路复检通过,隔离 NE 保持摘除。" },
        ],
        verdict: "规则:网络自愈完成 · 闭环验证通过。",
      };
    default: // 7 · Agent3 评估优化 · LLM 故障报告
      return phase7Analysis(s);
  }
}

/** 相位4 根因定位 + 输出评估 —— 按场景的 LLM/算法参与模型 */
function phase4Analysis(s: Scenario, type: string, rootNe: string): LlmAnalysis {
  // D/E:流控溯源算法(无 LLM)
  if (s.id === "D") {
    return {
      method: "algo",
      title: "注册风暴溯源算法",
      steps: [
        { label: "CPU+信令溯源", text: "AMF/SMF 容器 CPU 过载 + AMF 注册/上行 NAS、SMF N11 突增 → 注册/会话风暴冲击。" },
        { label: "终端溯源", text: "注册请求集中于物联终端(反复上线)→ 溯源到物联终端注册风暴,决策 UE 侧 back-off。" },
      ],
      verdict: "算法:溯源到物联终端注册风暴 · 决策 UE back-off(待执行)。",
    };
  }
  if (s.id === "E") {
    return {
      method: "algo",
      title: "二轮 UFDR 溯源算法",
      steps: [
        { label: "二轮 UFDR", text: "策略1(UE back-off)未收敛 → 二轮拉取 UPF UFDR:SST=3(MIoT) 注册突增 + 物联 DNN 突增。" },
        { label: "接入点溯源", text: "二轮溯源定位 AMF(物联 NSSAI)/SMF(物联 APN),决策策略2 双通道准入限流。" },
      ],
      verdict: "算法:二轮溯源到 AMF/SMF · 决策策略2(待执行)。",
    };
  }
  if (s.id === "F") {
    return {
      method: "algo",
      title: "分层接纳溯源 + 用户分类算法",
      principle: "UFDR 溯源 · APN/终端分类 · 分层接纳控制",
      steps: [
        { label: "🧮 UFDR + APN 分类", method: "algo", text: "CPU 过载 + UFDR 溯源 SST=3 + 物联平台 APN 异常(占 68%)→ 多 APN 中仅单一物联平台 APN 异常。" },
        { label: "🧮 终端类型分群", method: "algo", text: "终端分类:iPhone 占 35% 且不支持 back-off timer,收到 Reg Reject 立即重试。" },
        { label: "🤖 3 策略并行决策", method: "llm", text: "决策首轮 3 策略并行:UE back-off + AMF 限 NSSAI + SMF 限 DNN(接纳限流分层)。" },
      ],
      verdict: "算法:溯源到物联平台 APN + iPhone 终端异构 · 决策 3 策略并行(待执行)。",
    };
  }
  // A:确定性工作流 · 均质化比较 + 故障聚合算法(全程算法,无 LLM)
  if (s.id === "A") {
    return {
      method: "algo",
      title: "均质化比较 + 故障聚合算法",
      principle: "均质化比较 · 故障排除 · 故障聚合",
      steps: [
        { label: "🧮 均质化比较算法", method: "algo", text: "AMF↔SMF 通信路径全实例共性劣化 → 均质化排除 AMF/SMF 单点根因。" },
        { label: "🧮 故障聚合算法", method: "algo", text: "对 UPF 路径故障聚合,定位唯一离群点 UPF_1,隔离后切 UPF POOL。" },
      ],
      verdict: `算法:锁定根因 ${rootNe}(${roleOf(type)}) · 确定性工作流直达。`,
    };
  }
  // B:CHR 降噪 + 聚类算法(根因) → 大模型输出评估
  if (s.id === "B") {
    return {
      method: "algo",
      title: "CHR 降噪聚类算法 + 大模型评估",
      principle: "CHR 降噪 · 共因聚类 · 故障传播",
      steps: [
        { label: "🧮 CHR 降噪算法", method: "algo", text: "终端原因值长期基线偏高(非突增)→ 既有噪声剔除。" },
        { label: "🧮 共因聚类", method: "algo", text: "剩余原因值按共因聚类,5GSM#37 与突降同步 → 锁定 SMF_1。" },
        { label: "🤖 输出评估", method: "llm", text: "大模型对根因做置信度评估(首轮未通过则回 Agent1 补采 CHR)。" },
      ],
      verdict: `大模型:锁定根因 ${rootNe}(${roleOf(type)}) · 防误报/漏报。`,
    };
  }
  // C:大模型根因探索 + 输出评估(自主探索)
  if (s.id === "C") {
    return {
      method: "llm",
      title: "大模型根因探索 + 评估",
      principle: "多维探索 · 用户分群追踪 · 群体独立性",
      steps: [
        { label: "🤖 根因探索", method: "llm", text: "信号模糊、CHR 分散 → 大模型多维探索,首轮初判 AMF_1(注册方向)。" },
        { label: "🧮 用户分群", method: "algo", text: "首轮置信度不足 → 换角度用户分群追踪:gNB_2 物联终端群体失败率 52%。" },
        { label: "🤖 输出评估", method: "llm", text: "大模型评估:群体异常独立于网络 NE(全网健康),网络无需隔离。" },
      ],
      verdict: "大模型:定位物联终端群体异常 · 网络健康。",
    };
  }
  return {
    method: "llm",
    title: "大模型 · Agent Loop 推理",
    steps: [{ label: "多维推理", text: `大模型综合多维证据,故障聚合定位 ${rootNe}(${roleOf(type)})。` }],
    verdict: `大模型:锁定根因 ${rootNe}(${roleOf(type)}) · 防误报/漏报。`,
  };
}

/** 相位5 恢复策略 —— 多为规则编排(D/E 流控策略) */
function phase5Analysis(s: Scenario, rootNe: string, type: string): LlmAnalysis {
  if (s.id === "D") {
    return {
      method: "rule",
      title: "流控策略 · UE 侧 back-off",
      steps: [
        { label: "Reg Reject", text: "AMF 对注册成功的物联终端发 Registration Reject。" },
        { label: "back-off timer", text: "下发 back-off timer 抑制物联终端反复上线 → 注册冲击收敛。" },
      ],
      verdict: "规则:UE 侧 back-off 收敛 · 注册冲击下降。",
    };
  }
  if (s.id === "E") {
    return {
      method: "rule",
      title: "流控策略 · 网络侧准入控制(反压)",
      steps: [
        { label: "双通道限流", text: "20% UE 支持 back-off 不足以收敛 → AMF 限物联 NSSAI、SMF 限物联 APN/DNN。" },
        { label: "反压比例算法", text: "两限制比例按容器容量/实时流量/CPU 负载反压自保流控、PID 实时调节 → 收敛。" },
      ],
      verdict: "规则:反压双通道限流收敛 · 正常用户上网恢复。",
    };
  }
  if (s.id === "F") {
    return {
      method: "rule",
      title: "流控策略 · 三层并行(终端类型感知)",
      steps: [
        { label: "首轮 3 策略全下", text: "UE back-off T=12s + AMF ρ_AMF=75% + SMF ρ_SMF=70% 并行下发;iPhone 忽略 back-off 立即重试,失败反升。" },
        { label: "二轮排除 iPhone", text: "对 iPhone 不下发 back-off(由 AMF NSSAI 直接拦截)+ AMF ρ=57% / SMF ρ=52% 微调 → 失败陡降收敛。" },
      ],
      verdict: "规则:二轮终端类型感知调整 · 排除 iPhone back-off · 收敛。",
    };
  }
  return {
    method: "rule",
    title: "恢复策略编排规则",
    steps: [
      { label: "按型编排", text: `按故障类型规则编排:隔离 ${rootNe},流量切健康实例。` },
      { label: "规则下发", text: "规则式下发恢复动作,受影响 UE 无感切换。" },
    ],
    verdict: "规则:网络自愈中 · 流量已切换。",
  };
}

/** 相位7 · Agent3 评估优化 · LLM 故障报告(全过程:采集→感知→诊断→恢复→沉淀) */
function phase7Analysis(s: Scenario): LlmAnalysis {
  const rootNe = s.fault.elements[0] ?? "—";
  const type = neType(rootNe);
  // 各场景「故障感知 + 诊断 + 恢复」一句话摘要
  const perception: Record<string, string> = {
    A: `Agent 2 iFFusion 检测 AMF↔SMF 路径普遍劣化;均质化比较排除 AMF/SMF,故障聚合定位离群点 ${rootNe}(${roleOf(type)})。`,
    B: `Agent 2 检测 SMF 方向突降 + 终端噪声;首轮评估置信度不足回 Agent1,二轮 CHR 降噪排除终端噪声,5GSM#37 聚类锁定 ${rootNe}。`,
    C: `Agent 2 信号模糊;首轮大模型初判存疑回 Agent1,二轮用户分群追踪定位 gNB_2 物联终端群体异常(52% 失败),网络健康。`,
    D: "Agent 2 检测 AMF/SMF CPU 过载 + 注册/会话突增,溯源到物联终端风暴;UE 侧 back-off(Reg Reject + back-off timer)。",
    E: "Agent 2 检测 AMF/SMF CPU 过载 + 注册/会话突增;首轮 UE back-off 未收敛,二轮 UFDR 溯源 SST=3 + 物联 DNN,AMF 限 NSSAI + SMF 限 APN(反压比例算法)。",
    F: "Agent 2 检测 AMF/SMF CPU 过载 + 注册/会话突增;UFDR 溯源物联平台 APN + 终端分类发现 iPhone 不支持 back-off,决策首轮 3 策略并行。",
  };
  const recovery: Record<string, string> = {
    A: `隔离 ${rootNe},流量切至健康实例接管,受影响 UE 无感恢复。`,
    B: `隔离 ${rootNe},会话切健康 SMF 接管,受影响 UE 重建会话。`,
    C: "群体异常独立于网络 NE,网络无需隔离;下发用户侧恢复(换路/重选)。",
    D: "冲击收敛,2C 用户上网恢复。",
    E: "反压双通道限流收敛,注册/会话请求下降,2C 用户上网恢复。",
    F: "首轮 3 策略全下 iPhone back-off 失败反升;二轮排除 iPhone + 限流微调收敛,2C 用户上网恢复。",
  };
  const skill: Record<string, string> = {
    A: "均质化比较", B: "CHR 降噪", C: "用户分群追踪", D: "UFDR 流控溯源", E: "NSSAI/APN 准入控制", F: "终端类型感知的分层接纳控制",
  };
  return {
    method: "llm",
    title: "大模型 · 故障报告总结",
    steps: [
      { label: "🤖 数据采集", method: "llm", text: "Agent 1 实时采集 KPI / CHR / 3GPP 信令,LLM 多维校验通过,确认数据可信。" },
      { label: "🤖 故障感知", method: "llm", text: perception[s.id] ?? `Agent 2 检测异常并定位根因 ${rootNe}。` },
      { label: "🤖 恢复", method: "llm", text: recovery[s.id] ?? "执行恢复策略,网络自愈。" },
      { label: "🤖 沉淀", method: "llm", text: `Agent 3 评估闭环通过,沉淀「${skill[s.id] ?? "故障感知"}」skill,提升后续命中率。` },
    ],
    verdict: "大模型:故障报告已生成 · 全过程闭环 · skill 沉淀。",
  };
}

/** 方法元信息(图标/标签/配色),供弹窗渲染分析区表头与每步徽标 */
export const METHOD_META: Record<AnalysisMethod, { icon: string; label: string; color: string }> = {
  llm: { icon: "🤖", label: "大模型分析 · LLM", color: "#c4b5fd" },
  rule: { icon: "⚙", label: "规则引擎 · RULE", color: "#7dd3fc" },
  algo: { icon: "🧮", label: "算法 · ALGORITHM", color: "#fbbf24" },
};
