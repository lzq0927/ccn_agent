// ============================================================================
// App —— DEMO 默认 / LIVE 降级测试
//   覆盖:capabilities 空 → 留在 DEMO 并正常渲染;capabilities 拉取失败 → 不崩。
//   注:App 内 TopBar 用 useTheme,必须 ThemeProvider 包裹(main.tsx 同构)。
//   vitest globals:false → 需显式 cleanup。
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
import { ThemeProvider } from "./components/Shell/ThemeContext";

const renderApp = () =>
  render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );

describe("App", () => {
  beforeEach(() => {
    // capabilities 返回空 → 所有场景都不支持 LIVE(DEMO 模式)
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any),
    ) as any;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders without crashing in DEMO mode", () => {
    const { getByTestId } = renderApp();
    // DEMO 按钮处于激活态,LIVE 按钮不可用
    expect(getByTestId("mode-demo")).toBeTruthy();
    expect((getByTestId("mode-live") as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show live error banner by default", () => {
    const { queryByTestId } = renderApp();
    expect(queryByTestId("live-error")).toBeNull();
  });

  it("survives capabilities fetch failure", () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down"))) as any;
    const { getByTestId } = renderApp();
    expect(getByTestId("mode-demo")).toBeTruthy();
  });

  it("falls back to DEMO with an error banner when select fails", async () => {
    // capabilities 说场景 A 支持 LIVE,但 select 报 500 → 应降级 + 提示
    globalThis.fetch = vi.fn((url: any, init?: any) => {
      if (String(url).includes("/capabilities")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ A: "live" }) } as any);
      }
      if (String(url).includes("/select")) {
        return Promise.resolve({ ok: false, status: 500 } as any);
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) } as any);
    }) as any;

    const { getByTestId, findByTestId } = renderApp();
    // capabilities 落地后 LIVE 按钮解禁
    await waitFor(() =>
      expect((getByTestId("mode-live") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(getByTestId("mode-live"));
    const banner = await findByTestId("live-error");
    expect(banner.textContent).toContain("select 失败");
  });
});
