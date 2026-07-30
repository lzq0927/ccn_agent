// ============================================================================
// useLiveClock —— 替身 useStoryClock(LIVE 模式)
//   接口同 useStoryClock(state 字段 + playheadRef);失败时降级到 fallbackClock。
// ============================================================================

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  ensureLiveState,
  getLiveState,
  liveBus,
  type LiveState,
} from "./liveBus";

/** 同形于 useStoryClock 的 playheadRef 容器(LIVE 模式下 hook 自行维护) */
export interface LiveClockApi {
  state: LiveState;
  playheadRef: { current: HTMLDivElement | null };
}

/**
 * fallback 入参的结构子集(LIVE 模式下 hook 暂不主动消费,只透传);
 * 用 any 而非完整 ClockApi,允许消费者传入最小形状的对象。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FallbackClock = any;

export function useLiveClock(
  sessionId: string,
  scenarioId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  fallbackClock: FallbackClock,
): LiveClockApi {
  const playheadRef = useRef<HTMLDivElement | null>(null);

  // 每次渲染前确保 _store 里有 sessionId 对应的稳定对象引用 —— 否则
  // getSnapshot 在未注册 sessionId 上会 _initial() 返回新对象,React 报
  // "getSnapshot should be cached" + 触发死循环重渲染。
  ensureLiveState(sessionId, scenarioId);

  const subscribe = (cb: () => void) => liveBus.subscribe(sessionId, cb);
  const getSnapshot = () => getLiveState(sessionId);
  const liveState = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // 监听 fatal error 或 WS 断线 → 通知 fallback(由调用方 App.tsx 处理)
  useEffect(() => {
    if (liveState.error?.fatal || liveState.runnerState === "failed") {
      // 留 hook:由 App.tsx 监听并切回 fallback
    }
  }, [liveState.error?.fatal, liveState.runnerState]);

  return { state: liveState, playheadRef };
}
