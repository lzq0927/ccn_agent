import { useEffect, useRef, useState } from 'react'
import { Console } from './components/Console'
import { Icon } from './components/Icon'
import { WorkflowBar } from './components/WorkflowBar'
import { short } from './lib/format'
import { control, useLive } from './store'
import type { Meta, Stage, Topo } from './types'
import { AnalysisView } from './views/AnalysisView'
import { DecisionView } from './views/DecisionView'
import { PerceptionView } from './views/PerceptionView'

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  return now
}
const two = (n: number) => String(n).padStart(2, '0')

export default function App() {
  const state = useLive()
  const now = useNow()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [topo, setTopo] = useState<Topo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [view, setView] = useState<Stage>('perception')

  useEffect(() => {
    Promise.all([fetch('/api/meta').then((r) => r.json()), fetch('/api/topology').then((r) => r.json())])
      .then(([m, t]) => { setMeta(m); setTopo(t) })
      .catch(() => setLoadError(true))
  }, [])

  // 发现异常进入分析/决策时自动切到对应页面；回到常态感知后保留用户当前所在页面
  const prevStage = useRef<Stage | null>(null)
  useEffect(() => {
    const s = state.activeStage
    if (s && s !== prevStage.current && s !== 'perception') setView(s)
    prevStage.current = s
  }, [state.activeStage])
  // 重新开始后回到感知页
  useEffect(() => { if (state.connected && !state.tick) setView('perception') }, [state.connected, state.tick])
  // 打开页面时若已有进行中的故障，直接展示结论
  const opened = useRef(false)
  useEffect(() => {
    if (!opened.current && state.connected) {
      opened.current = true
      if (state.conclusion && state.incident?.status === 'active') setView('decision')
    }
  }, [state.connected, state.conclusion, state.incident])

  const inc = state.incident
  const c = state.conclusion
  const analyzing = state.activeStage !== 'perception' && Object.entries(state.steps).some(([k, v]) => !k.startsWith('perception.') && v === 'running')
  const agentStep = state.steps['analysis.agent']
  const agentState = agentStep === 'running' ? '推理中' : agentStep === 'skipped' ? '未触发' : agentStep === 'done' ? '已完成' : '待命'
  const pending = state.run?.pending ?? null
  const summaries: Record<Stage, string | null> = {
    perception: inc?.status === 'active' && state.perception ? `${state.perception.stats.n_anomalous} 个维度突增 · 降噪 ${Math.round(state.perception.stats.filtered_pct)}%`
      : state.tick ? '未见异常' : null,
    analysis: state.crossval ? (state.crossval.decision === 'conclusion' ? '唯一结论' : '转慢推理') : null,
    decision: c ? `${short(c.root.ne) || '待确认'} · 置信度 ${Math.round(c.confidence * 100)}%` : null,
  }
  // 交互方式下的引导：感知到异常后确认开始分析，分析完成后确认进入决策执行
  const proceed = () => { if (pending) { setView(pending); control('proceed') } }
  const guide = pending === 'analysis' && state.perception
    ? { title: '感知到异常', text: `${state.perception.stats.n_anomalous} 个维度持续突增，降噪后保留 ${state.perception.stats.kept.toLocaleString('en-US')} 条 CHR`, action: '开始分析', icon: 'alert' }
    : pending === 'decision' && state.crossval
      ? { title: '分析完成', text: state.crossval.decision === 'conclusion' ? '交叉验证得到唯一结论，可以给出结论与恢复方案' : `${state.crossval.reason}，已由慢推理给出可能原因`, action: '进入决策执行', icon: 'checkCircle' }
      : null
  const run = state.run
  const stepMode = (run?.mode ?? meta?.mode) === 'step'
  const going = state.connected && (!stepMode || run?.status === 'running')
  const status = !state.connected ? { cls: 'err', text: '连接中断，重连中' }
    : pending === 'analysis' ? { cls: 'alert', text: '感知到异常 · 待分析' }
      : pending === 'decision' ? { cls: 'alert', text: '分析完成 · 待决策执行' }
        : analyzing ? { cls: 'alert', text: '发现异常，分析中' }
      : inc?.status === 'active' ? { cls: 'alert', text: inc.definitive ? '故障进行中 · 根因已定位' : '故障进行中 · 待人工确认' }
        : inc?.status === 'recovered' ? { cls: 'ok', text: `故障已恢复 ${inc.recovered_at ?? ''}` }
          : stepMode && run?.status === 'idle' ? { cls: 'idle', text: '待开始' }
            : { cls: 'ok', text: '运行正常' }
  const d = new Date(now)
  const remain = state.nextAt ? Math.max(0, Math.round((state.nextAt - now) / 1000)) : null
  const runText = pending && run?.status === 'running' ? '等待确认' : { idle: '待开始', running: '运行中', paused: '已暂停', finished: '已结束' }[run?.status ?? 'idle']
  const pct = run?.total ? Math.min(100, (run.minute / run.total) * 100) : 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Icon name="activity" size={17} /></span>
          <div>
            <h1>CHR 故障感知与分析</h1>
            <p>5GC 云核心网{meta ? ` · ${meta.instances} 个网元实例 · 每分钟感知一次` : ''}</p>
          </div>
        </div>
        <div className="controls">
          <span className={`status ${status.cls}`}><i />{status.text}</span>
          {inc && <span className="inc-id">{inc.id}</span>}
          {stepMode ? (
            <>
              <div className="seg" role="group" aria-label="流程方式">
                <button className={run?.flow !== 'auto' ? 'on' : ''} onClick={() => control('interactive')} title="感知到异常后确认才分析，分析完成后确认才进入决策执行">交互</button>
                <button className={run?.flow === 'auto' ? 'on' : ''} onClick={() => control('auto')} title="各阶段自动连续执行">自动</button>
              </div>
              <span className="clock" title="当前数据时间"><Icon name="clock" size={14} /><b>{state.tick?.time ?? run?.time ?? '--:--'}</b></span>
              <span className={`live-pill ${pending ? 'paused' : run?.status === 'running' ? 'on' : run?.status ?? ''}`}><i />{runText}</span>
              {run?.status === 'running'
                ? <button className="btn" onClick={() => control('pause')}><Icon name="pause" size={13} />暂停</button>
                : run?.status === 'paused'
                  ? <button className="btn primary" onClick={() => control('resume')}><Icon name="play" size={13} />继续</button>
                  : run?.status === 'idle'
                    ? <button className="btn primary" onClick={() => control('start')}><Icon name="play" size={13} />开始</button>
                    : null}
              <button className={`btn ${run?.status === 'finished' ? 'primary' : ''}`} onClick={() => control('restart')}
                disabled={run?.status === 'idle'}><Icon name="restart" size={13} />重新开始</button>
            </>
          ) : (
            <>
              <span className="next">下次感知 <b>{remain == null ? '--' : `${two(Math.floor(remain / 60))}:${two(remain % 60)}`}</b></span>
              <span className="clock"><Icon name="clock" size={14} /><b>{two(d.getHours())}:{two(d.getMinutes())}:{two(d.getSeconds())}</b></span>
              <span className={`live-pill ${state.connected ? 'on' : ''}`}><i />实时</span>
            </>
          )}
        </div>
      </header>
      {stepMode && <div className="progress" aria-hidden><i style={{ width: `${pct}%` }} /></div>}

      <WorkflowBar steps={state.steps} activeStage={state.activeStage} connected={going && !pending} view={view} summaries={summaries}
        onView={setView} pending={pending} onProceed={proceed} />
      {guide && (
        <div className={`guide g-${pending}`} role="status">
          <span className="guide-icon"><Icon name={guide.icon} size={16} /></span>
          <div className="guide-text"><b>{guide.title}</b><span>{guide.text}</span></div>
          <button className="btn primary guide-btn" onClick={proceed}>{guide.action}<Icon name="arrowRight" size={14} /></button>
        </div>
      )}

      <div className="body">
        <main className="content">
          {loadError && <div className="card"><div className="empty tall">无法连接后端服务，请确认服务已启动。</div></div>}
          {meta && topo && (
            <>
              {view === 'perception' && <PerceptionView state={state} topo={topo} meta={meta} />}
              {view === 'analysis' && <AnalysisView state={state} onProceed={pending === 'analysis' ? proceed : undefined} />}
              {view === 'decision' && <DecisionView state={state} topo={topo} onProceed={pending === 'decision' ? proceed : undefined} />}
            </>
          )}
        </main>
        <Console logs={state.logs} agentLogs={state.agentLogs} agentState={agentState} />
      </div>
    </div>
  )
}
