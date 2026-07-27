import { describe, it, expect, beforeEach } from "vitest";
import { liveBus, getLiveState, applyEvent, resetLiveBus } from "./liveBus";

describe("liveBus", () => {
  beforeEach(() => {
    resetLiveBus();
  });

  it("applyEvent accumulates reasoning steps", () => {
    applyEvent("sess_1", "F", {
      type: "reasoning_step",
      payload: { n: 1, type: "thinking", text: "init" },
    });
    applyEvent("sess_1", "F", {
      type: "reasoning_step",
      payload: { n: 2, type: "conclusion", text: "root UPF_1" },
    });
    const st = getLiveState("sess_1");
    expect(st.recentSteps).toHaveLength(2);
    expect(st.recentSteps[0].n).toBe(1);
    expect(st.scenarioId).toBe("F");
  });

  it("runner_state updates runnerState", () => {
    applyEvent("sess_1", "F", {
      type: "runner_state",
      payload: { state: "simulating" },
    });
    expect(getLiveState("sess_1").runnerState).toBe("simulating");
  });

  it("subscribe fires on event", () => {
    const seen: string[] = [];
    liveBus.subscribe("sess_1", () => seen.push("fired"));
    applyEvent("sess_1", "F", { type: "tick", payload: { sim_t: 1 } });
    expect(seen).toEqual(["fired"]);
  });

  it("isolated per session", () => {
    applyEvent("sess_1", "F", { type: "runner_state", payload: { state: "done" } });
    applyEvent("sess_2", "E", { type: "runner_state", payload: { state: "init" } });
    expect(getLiveState("sess_1").runnerState).toBe("done");
    expect(getLiveState("sess_2").runnerState).toBe("init");
  });
});
