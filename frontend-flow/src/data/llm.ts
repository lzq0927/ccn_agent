// ============================================================================
// llm —— 「分析」叙事数据(分相位 · 场景化 · 区分 大模型 / 规则 / 算法)
//   给右侧弹窗的分析区:不是每个相位都有大模型参与,按实际方法标注:
//     llm  = 大模型参与(校验/推理/评估总结)
//     rule = 规则引擎(阈值监测/置信度评分/恢复编排/验证)
//     algo = 算法(iFFusion 融合检测等)
//   数据派生自 Scenario,确定性,不调后端。
// ============================================================================

import type { Scenario } from "./types";
import { ROUTE_COLORS } from "../theme";
import { getExploration } from "./plan";

export type AnalysisMethod = "llm" | "rule" | "algo";

export interface LlmAnalysis {
  method: AnalysisMethod;
  title: string;
  insights: string[];
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
  const m = s.evaluation;

  switch (phase) {
    case 0:
      return {
        method: "rule",
        title: "稳态监测规则",
        insights: [
          "逐链路成功率阈值规则:99.5% 基线,跌破即告警。",
          "整网聚合 99.8%、CHR 分布平稳,规则判定全网健康。",
        ],
        verdict: "规则:网络稳态 · 维持监测待命。",
      };
    case 1:
      return {
        method: "llm",
        title: "大模型 · 多维校验",
        insights: [
          "采集 KPI 逐链路时序 · CHR 原因值 · 3GPP 信令三路遥测。",
          "大模型多维校验 5 项通过(一致性/可观测性/拓扑/流程/标签)。",
        ],
        verdict: "大模型:数据可信 · 可进入检测。",
      };
    case 2:
      return {
        method: "algo",
        title: "iFFusion 融合检测算法",
        insights: [
          `KPI+CHR 双线融合检测:${type}(${roleOf(type)})方向链路跌破阈值。`,
          "整网聚合对微损无感,逐链路全面初筛方见异常。",
        ],
        verdict: "算法:存在异常 · 进入置信度研判。",
      };
    case 3:
      return {
        method: "rule",
        title: "置信度加权评分规则",
        insights: [
          `多维特征加权评分 ${s.confidence.score.toFixed(2)}(模式×0.4 + 严重×0.2 + 时空×0.3)。`,
          expl.iterations.length > 0
            ? `规则路由:技能引导/自主探索,需探索 ${expl.iterations.length} 轮收敛。`
            : "规则路由:命中已知签名,确定性工作流直达。",
        ],
        verdict: `规则:${expl.gateVerdict}`,
      };
    case 4:
      if (s.id === "D") {
        return {
          method: "algo",
          title: "注册风暴溯源",
          insights: [
            "AMF/SMF 容器 CPU 过载 + AMF 注册/上行 NAS、SMF N11 突增 → 注册/会话风暴冲击。",
            "注册请求集中于物联终端(反复上线)→ 溯源到物联终端注册风暴,决策 UE 侧 back-off。",
          ],
          verdict: "算法:溯源到物联终端注册风暴 · 决策 UE back-off(待执行)。",
        };
      }
      if (s.id === "E") {
        return {
          method: "algo",
          title: "二轮 UFDR 溯源算法",
          insights: [
            "策略1(UE back-off)执行后未收敛 → 二轮拉取 UPF UFDR:SST=3(MIoT) 注册突增 + 物联 DNN 突增。",
            "二轮溯源定位 AMF(物联 NSSAI)/SMF(物联 APN),决策策略2 双通道准入限流。",
          ],
          verdict: "算法:二轮溯源到 AMF/SMF · 决策策略2(待执行)。",
        };
      }
      return {
        method: "llm",
        title: "大模型 · Agent Loop 推理",
        insights: phase4Insights(s, type, rootNe),
        verdict: `大模型:锁定根因 ${rootNe}(${roleOf(type)}) · 防误报/漏报。`,
      };
    case 5:
      if (s.id === "D") {
        return {
          method: "rule",
          title: "流控策略 · UE 侧 back-off",
          insights: [
            "AMF 对注册成功的物联终端发 Registration Reject,并下发 back-off timer。",
            "back-off timer 抑制物联终端反复上线 → 注册冲击收敛。",
          ],
          verdict: "规则:UE 侧 back-off 收敛 · 注册冲击下降。",
        };
      }
      if (s.id === "E") {
        return {
          method: "rule",
          title: "流控策略 · 网络侧准入控制(反压)",
          insights: [
            "20% UE 支持 back-off 不足以收敛 → AMF 限制物联 NSSAI 接入、SMF 限制物联 APN/DNN 接入。",
            "两限制比例按容器容量/实时流量/CPU 负载做反压自保流控、PID 实时调节 → 注册/会话请求收敛。",
          ],
          verdict: "规则:反压双通道限流收敛 · 正常用户上网恢复。",
        };
      }
      return {
        method: "rule",
        title: "恢复策略编排规则",
        insights: [
          `按故障类型规则编排:隔离 ${rootNe},流量切健康实例。`,
          "规则式下发恢复动作,受影响 UE 无感切换。",
        ],
        verdict: "规则:网络自愈中 · 流量已切换。",
      };
    case 6:
      return {
        method: "rule",
        title: "闭环验证规则",
        insights: [
          "阈值复检:成功率回升至 99.8%,受影响链路回到基线。",
          "规则判定逐链路复检通过,隔离 NE 保持摘除。",
        ],
        verdict: "规则:网络自愈完成 · 闭环验证通过。",
      };
    default: // 7
      if (s.id === "D" || s.id === "E") {
        const fr = s.faultReport;
        return {
          method: "llm",
          title: "大模型 · 故障报告总结",
          insights: [
            `比对真值:P=${m.precision.toFixed(2)} · R=${m.recall.toFixed(2)} · F1=${m.f1.toFixed(2)} → ${m.category}。`,
            `大模型质析推理链,总结故障报告:根因「${fr?.rootCause ?? "物联终端风暴"}」、影响「${fr?.impact ?? "流控扩散至 2C 手机"}」。`,
            `处置「${fr?.action ?? "流控策略"}」→ ${fr?.outcome ?? "收敛恢复"};沉淀「${s.id === "D" ? "UFDR 流控溯源" : "NSSAI/APN 准入控制"}」skill。`,
          ],
          verdict: "大模型:故障报告已生成(详见弹窗) · 流控 skill 沉淀。",
        };
      }
      return {
        method: "llm",
        title: "大模型 · 评估与故障报告总结",
        insights: [
          `比对真值:P=${m.precision.toFixed(2)} · R=${m.recall.toFixed(2)} · F1=${m.f1.toFixed(2)} → ${m.category}。`,
          "大模型质析推理链(逻辑/工具/证据),并总结生成故障报告,沉淀/优化 故障感知 skill。",
        ],
        verdict: "大模型:闭环反馈 · 故障报告已生成 · skill 沉淀。",
      };
  }
}

function phase4Insights(s: Scenario, type: string, rootNe: string): string[] {
  switch (s.id) {
    case "A":
      return [
        "AMF↔SMF 路径均质化异常(全实例共性)→ 排除 AMF/SMF 单点。",
        "UPF 路径故障聚合,定位离群点 UPF_1,隔离后切 UPF POOL。",
      ];
    case "B":
      return [
        "CHR 时序统计:终端原因值长期偏高(既有噪声),非突增。",
        "CHR 降噪排除终端后,5GSM#37 与突降同步 → 锁定 SMF_1。",
      ];
    case "C":
      return [
        "第 1 轮 CHR 聚类:原因值分散、无网络共因 → 未收敛。",
        "第 2 轮用户分群:gNB_2 物联终端群体 52% 失败 → 收敛(网络健康)。",
      ];
    default:
      return [`大模型综合多维证据,故障聚合定位 ${rootNe}(${roleOf(type)})。`];
  }
}

/** 方法元信息(图标/标签/配色),供弹窗渲染分析区表头 */
export const METHOD_META: Record<AnalysisMethod, { icon: string; label: string; color: string }> = {
  llm: { icon: "🤖", label: "大模型分析 · LLM", color: "#c4b5fd" },
  rule: { icon: "⚙", label: "规则引擎 · RULE", color: "#7dd3fc" },
  algo: { icon: "🧮", label: "算法 · ALGORITHM", color: "#fbbf24" },
};
