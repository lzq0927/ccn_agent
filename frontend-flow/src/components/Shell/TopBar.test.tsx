// ============================================================================
// TopBar —— DEMO/LIVE 切换测试
//   覆盖:渲染两个按钮 · 点击 LIVE 触发 onModeChange
//   T7.2 接入 App 后,此测试将作为回归保护。
// ============================================================================

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TopBar } from "./TopBar";
import { ThemeProvider } from "./ThemeContext";

// 注:TopBar 内部 useTheme 需要 ThemeProvider 包裹。
// 切到 LIVE 按钮用 data-testid 定位(见 TopBar.tsx),title 文本与按钮文本
// 重复会干扰 getByRole,testid 是最稳定的查询。
// vitest config globals:false → RTL 不会自动清理,需显式 cleanup。

const baseState = {
  scenarioId: "F",
  phaseIndex: 0,
  phase: { cn: "网络就绪", en: "READY", color: "#22c55e" } as any,
  phaseProgress: 0,
  globalProgress: 0,
  simT: 0,
  loop: 0,
  round: 1 as 1 | 2,
  loopBackKind: null,
  twinMode: "healthy" as const,
  showAnomaly: false,
  affectedNe: [],
  rootCause: { nes: [], links: [] },
  recoveryActive: false,
  recoveryActions: [],
  rerouteEdges: [],
  cordonedNe: [],
  activeAgent: 0 as 0,
  route: null,
  confidence: null,
  confidenceReveal: 0,
  reasoningSteps: [],
  reasoningTotal: 0,
  evalRevealed: false,
  evalMetrics: null,
  generationChecks: [],
  generationChecksReveal: 0,
  headline: "",
  subline: "",
  algorithms: [],
  cpuOverloadNe: [],
  ufdrPopup: null,
  flowControlPopup: null,
  currentStep: null,
  comparisonReveal: 0,
  chrPopup: null,
  homogenPopup: null,
  isolationPopup: null,
  falseAlarmActive: false,
  falseAlarmIntercepted: false,
  userLevel: null,
  userLevelActive: false,
  skillReveal: 0,
};

const baseClock = {
  state: baseState,
  time: 0,
  playing: true,
  speed: 1,
  loop: 0,
  duration: 60,
  playheadRef: { current: null },
  play: () => {},
  pause: () => {},
  toggle: () => {},
  setSpeed: () => {},
  seekGlobal: () => {},
  seekPhase: () => {},
};

const baseScenario = { id: "F", cn: "F 场景" } as any;

describe("TopBar DEMO/LIVE 切换", () => {
  afterEach(() => cleanup());
  it("renders DEMO/LIVE toggle button", () => {
    const onModeChange = vi.fn();
    const { getByText } = render(
      <ThemeProvider>
        <TopBar
          clock={baseClock}
          state={baseState}
          scenario={baseScenario}
          mode="demo"
          onModeChange={onModeChange}
          liveCapabilities={{ F: "live", A: "demo" }}
        />
      </ThemeProvider>
    );
    expect(getByText(/DEMO/i)).toBeTruthy();
  });

  it("clicking LIVE button calls onModeChange", () => {
    const onModeChange = vi.fn();
    const { getByTestId } = render(
      <ThemeProvider>
        <TopBar
          clock={baseClock}
          state={baseState}
          scenario={baseScenario}
          mode="demo"
          onModeChange={onModeChange}
          liveCapabilities={{ F: "live", A: "demo" }}
        />
      </ThemeProvider>
    );
    fireEvent.click(getByTestId("mode-live"));
    expect(onModeChange).toHaveBeenCalledWith("live");
  });
});
