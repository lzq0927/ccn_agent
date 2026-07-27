import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLiveClock } from "./useLiveClock";
import { applyEvent, resetLiveBus } from "./liveBus";

describe("useLiveClock", () => {
  beforeEach(() => resetLiveBus());

  it("returns initial state", () => {
    const { result } = renderHook(() =>
      useLiveClock("sess_1", "F", /*fallbackClock*/ { state: null as any, duration: 0, playheadRef: { current: null } })
    );
    expect(result.current.state.runnerState).toBe("unknown");
    expect(result.current.state.scenarioId).toBe("F");
  });

  it("updates on runner_state event", () => {
    const { result } = renderHook(() =>
      useLiveClock("sess_1", "F", { state: null as any, duration: 0, playheadRef: { current: null } })
    );
    act(() => {
      applyEvent("sess_1", "F", { type: "runner_state", payload: { state: "simulating" } });
    });
    expect(result.current.state.runnerState).toBe("simulating");
  });
});
