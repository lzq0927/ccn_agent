import type { Stage, StepStatus } from '../types'
import { Icon } from './Icon'

interface StepDef { id: string; name: string; note?: string }
const STAGES: { id: Stage; no: string; name: string; icon: string; steps: (StepDef | StepDef[])[] }[] = [
  { id: 'perception', no: '1', name: '感知', icon: 'activity',
    steps: [{ id: 'preprocess', name: '数据预处理' }, { id: 'denoise', name: 'CHR 降噪' }] },
  { id: 'analysis', no: '2', name: '分析', icon: 'search',
    steps: [{ id: 'flows', name: '业务流还原' }, [{ id: 'cluster', name: '特征聚类' }, { id: 'kg', name: '图谱推理' }],
      { id: 'crossval', name: '交叉验证' }, { id: 'agent', name: '慢推理 Agent', note: '按需' }] },
  { id: 'decision', no: '3', name: '决策执行', icon: 'zap',
    steps: [{ id: 'conclusion', name: '结论与恢复方案' }, { id: 'handoff', name: '移交执行', note: '外部' }] },
]

interface Props {
  steps: Record<string, StepStatus>
  activeStage: Stage | null
  running: boolean
  view: Stage
  onView: (s: Stage) => void
  summaries: Record<Stage, string | null>
}

const SR: Record<StepStatus, string> = { idle: '未开始', running: '进行中', done: '已完成', skipped: '未触发' }

export function WorkflowBar({ steps, activeStage, running, view, onView, summaries }: Props) {
  const pill = (stage: Stage, s: StepDef) => {
    const st = steps[`${stage}.${s.id}`] ?? 'idle'
    return (
      <span key={s.id} className={`pill ${st}`} title={SR[st]}>
        <i className="dot">{st === 'done' && <Icon name="check" size={9} />}</i>
        <span>{s.name}</span>
        {(s.note || st === 'skipped') && <em>{st === 'skipped' ? '未触发' : s.note}</em>}
      </span>
    )
  }
  const stageState = (id: Stage) => {
    const all = STAGES.find((s) => s.id === id)!.steps.flat()
    const sts = all.map((s) => steps[`${id}.${s.id}`] ?? 'idle')
    const live = running && activeStage === id
    const done = !live && sts.some((s) => s === 'done') && sts.every((s) => s !== 'running' && s !== 'idle')
    return { live, done }
  }
  return (
    <nav className="workflow" aria-label="工作流">
      {STAGES.map((stage, idx) => {
        const { live, done } = stageState(stage.id)
        return (
          <div key={stage.id} className={`wf-wrap s-${stage.id}`}>
            <button className={`wf-stage ${live ? 'live' : ''} ${done ? 'done' : ''} ${view === stage.id ? 'viewing' : ''}`}
              onClick={() => onView(stage.id)} aria-pressed={view === stage.id}>
              <div className="wf-head">
                <span className="wf-icon"><Icon name={done ? 'check' : stage.icon} size={15} /></span>
                <span className="wf-name">{stage.name}</span>
                {live && <span className="wf-live"><i />进行中</span>}
                {!live && summaries[stage.id] && <span className="wf-sum">{summaries[stage.id]}</span>}
              </div>
              <div className="wf-steps">
                {stage.steps.map((s, i) => (
                  <span key={i} className="wf-step-wrap">
                    {i > 0 && <span className="wf-arrow" />}
                    {Array.isArray(s) ? <span className="wf-parallel">{s.map((x) => pill(stage.id, x))}</span> : pill(stage.id, s)}
                  </span>
                ))}
              </div>
            </button>
            {idx < STAGES.length - 1 && <span className={`wf-link ${done ? 'on' : ''} ${live ? 'flow' : ''}`} aria-hidden />}
          </div>
        )
      })}
    </nav>
  )
}
