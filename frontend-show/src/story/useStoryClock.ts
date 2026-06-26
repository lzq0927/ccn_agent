// ============================================================================
// useStoryClock —— rAF 驱动的确定性时钟。播放/暂停/变速/拖拽/跳阶段。
// 每帧用 director 派生 StoryState,驱动全部视图。
// ============================================================================

import { useEffect, useRef, useState } from "react";
import type { Scenario } from "../data/types";
import { direct, LOOP_DURATION, PHASE_DURATIONS } from "./director";
import type { StoryState } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export interface ClockApi {
  state: StoryState;
  time: number;
  playing: boolean;
  speed: number;
  loop: number;
  duration: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setSpeed: (n: number) => void;
  seekGlobal: (frac: number) => void;
  seekPhase: (i: number) => void;
}

export function useStoryClock(scenario: Scenario): ClockApi {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(0);

  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const loopRef = useRef(0);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    let raf = 0;
    const tick = (now: number) => {
      if (lastRef.current == null) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (playingRef.current) {
        let nt = timeRef.current + dt * speedRef.current;
        if (nt >= LOOP_DURATION) {
          nt -= LOOP_DURATION;
          loopRef.current += 1;
          setLoop(loopRef.current);
        }
        timeRef.current = nt;
        setTime(nt);
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
    lastRef.current = null;
  }, [scenario.id]);

  const play = () => setPlaying(true);
  const pause = () => setPlaying(false);
  const toggle = () => setPlaying((p) => !p);
  const setSpeedN = (n: number) => setSpeed(n);
  const seekGlobal = (frac: number) => {
    const nt = clamp(frac, 0, 0.9999) * LOOP_DURATION;
    timeRef.current = nt;
    setTime(nt);
  };
  const seekPhase = (i: number) => {
    let acc = 0;
    for (let k = 0; k < i && k < PHASE_DURATIONS.length; k++) acc += PHASE_DURATIONS[k];
    timeRef.current = acc;
    setTime(acc);
  };

  const state = direct(scenario, time, loop);

  return {
    state,
    time,
    playing,
    speed,
    loop,
    duration: LOOP_DURATION,
    play,
    pause,
    toggle,
    setSpeed: setSpeedN,
    seekGlobal,
    seekPhase,
  };
}
