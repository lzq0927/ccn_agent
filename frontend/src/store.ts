import { useEffect, useReducer } from 'react'
import type { AppState, Incident, LogLine, Stage, StepStatus, Tick } from './types'

const KEEP_LOGS = 400
const KEEP_TREND = 60
const ANALYSIS = { perception: null, flows: null, clustering: null, kg: null, crossval: null, agent: null, conclusion: null }

export const initialState: AppState = {
  connected: false, steps: {}, activeStage: null, logs: [], agentLogs: [], tick: null, trend: [],
  incident: null, incidents: [], nextAt: null, ...ANALYSIS,
}

type Snapshot = Omit<AppState, 'connected' | 'nextAt'> & { next_in: number }
type Ev =
  | { type: 'open' }
  | { type: 'closed' }
  | ({ type: 'snapshot' } & Snapshot)
  | { type: 'step'; stage: Stage; step: string; status: StepStatus }
  | ({ type: 'log' } & LogLine)
  | ({ type: 'tick' } & Tick)
  | { type: 'result'; key: string; data: unknown }
  | { type: 'incident'; event: 'opened' | 'updated' | 'recovered'; incident: Incident }

const deadline = (nextIn?: number) => (nextIn == null ? null : Date.now() + nextIn * 1000)

function reducer(state: AppState, ev: Ev): AppState {
  switch (ev.type) {
    case 'open':
      return { ...state, connected: true }
    case 'closed':
      return { ...state, connected: false }
    case 'snapshot': {
      const { type: _t, next_in, ...rest } = ev
      return { ...rest, connected: true, nextAt: deadline(next_in) }
    }
    case 'step': {
      const steps = { ...state.steps, [`${ev.stage}.${ev.step}`]: ev.status }
      return { ...state, steps, activeStage: ev.status === 'running' ? ev.stage : state.activeStage }
    }
    case 'log': {
      const { type: _t, ...line } = ev
      return line.channel === 'agent'
        ? { ...state, agentLogs: [...state.agentLogs, line].slice(-KEEP_LOGS) }
        : { ...state, logs: [...state.logs, line].slice(-KEEP_LOGS) }
    }
    case 'tick': {
      const { type: _t, ...tick } = ev
      return {
        ...state, tick, nextAt: deadline(tick.next_in) ?? state.nextAt,
        trend: [...state.trend, { label: tick.trend_point.label, total: tick.trend_point.total }].slice(-KEEP_TREND),
      }
    }
    case 'result':
      return { ...state, [ev.key]: ev.data } as AppState
    case 'incident': {
      if (ev.event === 'opened') {
        // 新故障：清空上一轮的分析结果与步骤状态
        const steps = Object.fromEntries(Object.entries(state.steps).filter(([k]) => k.startsWith('perception.')))
        return { ...state, ...ANALYSIS, steps, incident: ev.incident }
      }
      const incidents = ev.event === 'recovered' ? [ev.incident, ...state.incidents].slice(0, 20) : state.incidents
      return { ...state, incident: ev.incident, incidents }
    }
  }
}

/** 订阅后端实时事件流（SSE）。连接建立后先收到一份状态快照，断线由浏览器自动重连。 */
export function useLive() {
  const [state, dispatch] = useReducer(reducer, initialState)
  useEffect(() => {
    const es = new EventSource('/api/stream')
    es.onopen = () => dispatch({ type: 'open' })
    es.onmessage = (m) => dispatch(JSON.parse(m.data) as Ev)
    es.onerror = () => dispatch({ type: 'closed' })
    return () => es.close()
  }, [])
  return state
}
