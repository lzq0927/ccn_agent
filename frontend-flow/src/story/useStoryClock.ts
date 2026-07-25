// ============================================================================
// useStoryClock —— rAF 驱动的确定性时钟。播放/暂停/变速/拖拽/跳阶段。
// 每帧用 director 派生 StoryState，驱动全部视图。
// 优化:播放头由 rAF 直接驱动 DOM(与 React 渲染解耦),React 树降频 ~30fps
// 刷新 —— 鼠标在画面上移动时播放头也按帧推进，不再因整树重渲染卡住。
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../data/types";
import { direct, PHASE_DURATIONS, loopDurationFor } from "./director";
import type { StoryState } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** React 树刷新上限(~30fps):削减每帧整树重渲染开销 */
const REACT_TICK = 1 / 30;

export interface ClockApi {
  state: StoryState;
  time: number;
  playing: boolean;
  speed: number;
  loop: number;
  duration: number;
  /** 播放头 DOM 节点(由 Timeline 挂载);rAF 直接驱动 left，不依赖 React 渲染 */
  playheadRef: { current: HTMLDivElement | null };
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (n: number) => void;
  seekGlobal: (frac: number) => void;
  seekPhase: (i: number) => void;
}

export function useStoryClock(scenario: Scenario): ClockApi {
  const LOOP_DURATION = loopDurationFor(scenario);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);

  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const loopRef = useRef(0);
  const lastRef = useRef<number | null>(null);
  const reactAccumRef = useRef(0);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const durRef = useRef(LOOP_DURATION);

  useEffect(() => { durRef.current = loopDurationFor(scenario); }, [scenario.id]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  /** 把播放头 left 同步到 timeRef 当前值(供跳转 / 复位时即时校正) */
  const syncPlayhead = () => {
    const ph = playheadRef.current;
    if (ph) ph.style.left = `${(timeRef.current / durRef.current) * 100}%`;
  };

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (playingRef.current) {
        const dur = durRef.current;
        let nt = timeRef.current + dt * speedRef.current;
        if (nt >= dur) {
          nt -= dur;
          loopRef.current += 1;
          setLoop(loopRef.current);
        }
        timeRef.current = nt;
        // 播放头直接驱动 DOM:每帧推进，不随 React 渲染节流，鼠标交互也不卡
        const ph = playheadRef.current;
        if (ph) ph.style.left = `${(nt / dur) * 100}%`;
        // React 树降频刷新(~30fps)，削减每帧整树重渲染开销
        reactAccumRef.current += dt;
        if (reactAccumRef.current >= REACT_TICK) {
          reactAccumRef.current -= REACT_TICK;
          setTime(nt);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 切换场景时复位到阶段0
  useEffect(() => {
    timeRef.current = 0;
    setTime(0);
    reactAccumRef.current = 0;
    lastRef.current = null;
    syncPlayhead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenario.id]);

  const play = () => setPlaying(true);
  const pause = () => setPlaying(false);
  const toggle = () => setPlaying((p) => !p);
  const setSpeedN = (n: number) => setSpeed(n);
  const seekGlobal = (frac: number) => {
    const nt = clamp(frac, 0, 0.9999) * durRef.current;
    timeRef.current = nt;
    setTime(nt);
    syncPlayhead();
  };
  const seekPhase = (i: number) => {
    let acc = 0;
    for (let k = 0; k < i && k < PHASE_DURATIONS.length; k++) acc += PHASE_DURATIONS[k];
    timeRef.current = acc;
    setTime(acc);
    syncPlayhead();
  };

  const state = direct(scenario, time, loop);

  return {
    state,
    time,
    playing,
    speed,
    loop,
    duration: durRef.current,
    playheadRef,
    play,
    pause,
    toggle,
    setSpeed: setSpeedN,
    seekGlobal,
    seekPhase,
  };
}
