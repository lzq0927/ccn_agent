// ============================================================================
// useSimClock —— SIM 模式实时仿真时钟
//   rAF 驱动 sim engine(stepSim)平滑推进;用 simT 调 direct(scenario, t, loop)
//   产出 StoryState(复用 DEMO 全套视图);React 树 ~30fps 降频刷新。
//   返回 ClockApi 兼容接口(+ sim/strategy/neCpu),驱动 TopBar/Timeline/SolutionFlow/ExecutionPanel。
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../data/types";
import type { NetworkGraph } from "../data/network";
import { direct, LOOP_DURATION, PHASE_DURATIONS } from "./director";
import type { StoryState } from "./types";
import type { ClockApi } from "./useStoryClock";
import { initSim, mulberry32, stepSim } from "../sim/engine";
import type { SimState, SimStrategy } from "../sim/types";

const REACT_TICK = 1 / 30;

/** 全网 NE CPU%:AMF/SMF 来自 sim;其它按风暴强度 + 网元类型估算 + 实例噪声 */
function computeNeCpu(sim: SimState, graph?: NetworkGraph): Record<string, number> {
  if (!graph) return {};
  const si = sim.stormIntensity;
  const out: Record<string, number> = {};
  let seed = (Math.floor(sim.t * 10) + 1) | 0;
  const noise = () => {
    seed = (Math.imul(seed, 9301) + 49297) % 233280;
    return seed / 233280;
  };
  for (const n of graph.nodes) {
    let cpu: number;
    if (n.type === "AMF") cpu = sim.amfCpu;
    else if (n.type === "SMF") cpu = sim.smfCpu;
    else if (n.type === "gNB") cpu = 30 + si * 14;
    else if (n.type === "UPF") cpu = 32 + si * 10;
    else cpu = 26 + si * 4;
    cpu += (noise() - 0.5) * 4;
    out[n.id] = Math.max(5, Math.min(99, Math.round(cpu)));
  }
  return out;
}

export interface SimClockApi extends ClockApi {
  sim: SimState;
  strategy: SimStrategy;
  setStrategy: (s: SimStrategy) => void;
}

export function useSimClock(scenario: Scenario, initialStrategy: SimStrategy = "D"): SimClockApi {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);
  const [strategy, setStrategyState] = useState<SimStrategy>(initialStrategy);

  const simRef = useRef<SimState>(initSim(initialStrategy));
  const rngRef = useRef(mulberry32(initialStrategy === "D" ? 12345 : 67890));
  const timeRef = useRef(0);
  const loopRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const lastRef = useRef<number | null>(null);
  const reactAccumRef = useRef(0);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const strategyRef = useRef(initialStrategy);

  useEffect(() => { playingRef.current = playing; }, [playing]);
  useEffect(() => { speedRef.current = speed; }, [speed]);
  useEffect(() => { strategyRef.current = strategy; }, [strategy]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (playingRef.current) {
        // 推进 sim engine
        simRef.current = stepSim(simRef.current, dt * speedRef.current, rngRef.current);
        timeRef.current = simRef.current.t;
        if (simRef.current.loop !== loopRef.current) {
          loopRef.current = simRef.current.loop;
        }
        // 播放头 DOM 直接驱动
        const ph = playheadRef.current;
        if (ph) ph.style.left = `${(timeRef.current / LOOP_DURATION) * 100}%`;
        // React 降频
        reactAccumRef.current += dt;
        if (reactAccumRef.current >= REACT_TICK) {
          reactAccumRef.current -= REACT_TICK;
          setTime(timeRef.current);
          setLoop(loopRef.current);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 策略 / 场景 切换重置
  useEffect(() => {
    simRef.current = initSim(strategy);
    rngRef.current = mulberry32(strategy === "D" ? 12345 : 67890);
    timeRef.current = 0;
    loopRef.current = 0;
    setTime(0);
    setLoop(0);
    reactAccumRef.current = 0;
    lastRef.current = null;
    const ph = playheadRef.current;
    if (ph) ph.style.left = "0%";
  }, [strategy, scenario.id]);

  const state = direct(scenario, time, loop);
  const sim = simRef.current;
  const neCpu = computeNeCpu(sim, scenario.realGraph);
  const augmented: StoryState = {
    ...state,
    simNeCpu: neCpu,
    simRates: {
      amfCpu: sim.amfCpu, smfCpu: sim.smfCpu,
      regRate: sim.regRate, iotRegRate: sim.iotRegRate,
      sessionRate: sim.sessionRate, twoCThrottle: sim.twoCThrottle,
    },
  };

  const seekPhase = (i: number) => {
    let acc = 0;
    for (let k = 0; k < i && k < PHASE_DURATIONS.length; k++) acc += PHASE_DURATIONS[k];
    simRef.current = { ...simRef.current, t: acc };
    timeRef.current = acc;
    setTime(acc);
    const ph = playheadRef.current;
    if (ph) ph.style.left = `${(acc / LOOP_DURATION) * 100}%`;
  };

  return {
    state: augmented,
    sim,
    strategy,
    setStrategy: setStrategyState,
    time,
    playing,
    speed,
    loop,
    duration: LOOP_DURATION,
    playheadRef,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => !p),
    setSpeed,
    seekGlobal: (frac: number) => {
      const nt = Math.max(0, Math.min(0.9999, frac)) * LOOP_DURATION;
      simRef.current = { ...simRef.current, t: nt };
      timeRef.current = nt;
      setTime(nt);
    },
    seekPhase,
  };
}
