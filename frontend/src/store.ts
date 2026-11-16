import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { AppState, LogLine, Stage, StepStatus, Tick } from './types'

export const initialState: AppState = {
  status: 'idle', steps: {}, activeStage: null, logs: [], agentLogs: [], tick: null, trend: [], alarmLabel: null,
  perception: null, flows: null, clustering: null, kg: null, crossval: null, agent: null, conclusion: null,
}

type Ev =
  | { type: 'reset' }
  | { type: 'error' }
  | { type: 'step'; stage: Stage; step: string; status: StepStatus }
  | ({ type: 'log' } & LogLine)
  | ({ type: 'tick' } & Tick)
  | { type: 'result'; key: string; data: unknown }
  | { type: 'done'; incident: boolean }

function reducer(state: AppState, ev: Ev): AppState {
  switch (ev.type) {
    case 'reset':
      return { ...initialState, status: 'running', activeStage: 'perception' }
    case 'error':
      return { ...state, status: 'error' }
    case 'step': {
      const steps = { ...state.steps, [`${ev.stage}.${ev.step}`]: ev.status }
      return { ...state, steps, activeStage: ev.status === 'running' ? ev.stage : state.activeStage }
    }
    case 'log': {
      const { type: _t, ...line } = ev
      return line.channel === 'agent'
        ? { ...state, agentLogs: [...state.agentLogs, line] }
        : { ...state, logs: [...state.logs, line] }
    }
    case 'tick': {
      const { type: _t, ...tick } = ev
      return { ...state, tick, trend: [...state.trend, { label: tick.trend_point.label, total: tick.trend_point.total }] }
    }
    case 'result': {
      const next = { ...state, [ev.key]: ev.data } as AppState
      if (ev.key === 'perception' && state.tick) next.alarmLabel = state.trend[state.trend.length - 1]?.label ?? null
      return next
    }
    case 'done':
      return { ...state, status: 'done' }
  }
}

/** 订阅后端回放事件流（SSE）。 */
export function useRun() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const source = useRef<EventSource | null>(null)

  const stop = useCallback(() => {
    source.current?.close()
    source.current = null
  }, [])

  const start = useCallback((speed: number) => {
    stop()
    dispatch({ type: 'reset' })
    const es = new EventSource(`/api/run/stream?speed=${speed}`)
    source.current = es
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as Ev
      dispatch(ev)
      if (ev.type === 'done') stop()
    }
    es.onerror = () => {
      // EventSource 默认会自动重连并重新开始回放，这里显式关闭
      if (source.current === es) {
        stop()
        dispatch({ type: 'error' })
      }
    }
  }, [stop])

  useEffect(() => stop, [stop])
  return { state, start }
}
