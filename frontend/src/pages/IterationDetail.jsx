import React from 'react'
import { useParams, Link } from 'react-router-dom'
import { useIteration } from '../hooks/useApi'
import AgentStatusPanel from '../components/AgentStatusPanel'
import CaseCard from '../components/CaseCard'
import { formatDate, formatDuration, formatPercent, formatConfidence } from '../utils/formatters'
import { getStatusColor, getStatusLabel, getAccuracyColor } from '../utils/constants'

export default function IterationDetail() {
  const { id } = useParams()
  const { data: iteration, loading, error } = useIteration(id)

  if (loading) {
    return <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>加载中...</div>
  }

  if (error || !iteration) {
    return (
      <div style={{ color: '#f4212e', padding: '40px', textAlign: 'center' }}>
        加载失败: {error || '迭代不存在'}
      </div>
    )
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start'
  }

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea'
  }

  const badgeStyle = (status) => ({
    padding: '4px 12px',
    borderRadius: '16px',
    background: `${getStatusColor(status)}20`,
    color: getStatusColor(status),
    fontSize: '12px',
    fontWeight: '500'
  })

  const sectionStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '20px'
  }

  const sectionTitleStyle = {
    fontSize: '16px',
    fontWeight: '600',
    color: '#e7e9ea',
    marginBottom: '16px'
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px'
  }

  const metricStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }

  const metricLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const metricValueStyle = {
    fontSize: '20px',
    fontWeight: '600',
    color: '#e7e9ea'
  }

  const listStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }

  const listItemStyle = {
    padding: '12px',
    background: '#0f1419',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#8b98a5'
  }

  const casesGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '16px'
  }

  const backLinkStyle = {
    color: '#1d9bf0',
    textDecoration: 'none',
    fontSize: '14px'
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <Link to="/" style={backLinkStyle}>← 返回总览</Link>
          <h1 style={{ ...titleStyle, marginTop: '8px' }}>迭代 #{iteration.iteration}</h1>
          <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
            <span style={badgeStyle(iteration.data_gen_status)}>
              数据生成: {getStatusLabel(iteration.data_gen_status)}
            </span>
            <span style={badgeStyle(iteration.perception_status)}>
              感知: {getStatusLabel(iteration.perception_status)}
            </span>
            <span style={badgeStyle(iteration.eval_status)}>
              评估: {getStatusLabel(iteration.eval_status)}
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', color: '#8b98a5', fontSize: '13px' }}>
          <div>开始: {formatDate(iteration.started_at)}</div>
          {iteration.completed_at && <div>完成: {formatDate(iteration.completed_at)}</div>}
          {iteration.started_at && iteration.completed_at && (
            <div style={{ marginTop: '4px' }}>
              耗时: {formatDuration(new Date(iteration.completed_at) - new Date(iteration.started_at))}
            </div>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>迭代指标</h2>
        <div style={gridStyle}>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>生成案例数</span>
            <span style={metricValueStyle}>{iteration.data_gen_cases_generated ?? 0}</span>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>通过案例数</span>
            <span style={metricValueStyle}>{iteration.data_gen_cases_passed ?? 0}</span>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>感知准确率</span>
            <span style={{ ...metricValueStyle, color: getAccuracyColor(iteration.perception_accuracy ?? 0) }}>
              {formatPercent(iteration.perception_accuracy ?? 0)}
            </span>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>平均置信度</span>
            <span style={metricValueStyle}>{formatConfidence(iteration.perception_avg_confidence ?? 0)}</span>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>新增难例数</span>
            <span style={metricValueStyle}>{iteration.new_cases_from_failures ?? 0}</span>
          </div>
          <div style={metricStyle}>
            <span style={metricLabelStyle}>优化建议数</span>
            <span style={metricValueStyle}>
              {(iteration.skills_updated?.length ?? 0) + (iteration.prompts_updated?.length ?? 0)}
            </span>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>优化动作</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <h3 style={{ fontSize: '13px', color: '#8b98a5', marginBottom: '8px' }}>更新的 Skills</h3>
            <div style={listStyle}>
              {(iteration.skills_updated || []).length > 0 ? (
                iteration.skills_updated.map(skill => (
                  <div key={skill} style={listItemStyle}>{skill}</div>
                ))
              ) : (
                <div style={{ ...listItemStyle, textAlign: 'center' }}>无</div>
              )}
            </div>
          </div>
          <div>
            <h3 style={{ fontSize: '13px', color: '#8b98a5', marginBottom: '8px' }}>更新的 Prompts</h3>
            <div style={listStyle}>
              {(iteration.prompts_updated || []).length > 0 ? (
                iteration.prompts_updated.map(prompt => (
                  <div key={prompt} style={listItemStyle}>{prompt}</div>
                ))
              ) : (
                <div style={{ ...listItemStyle, textAlign: 'center' }}>无</div>
              )}
            </div>
          </div>
        </div>
      </div>

      {iteration.perception_output && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>感知输出</h2>
          <div style={gridStyle}>
            <div style={metricStyle}>
              <span style={metricLabelStyle}>感知模式</span>
              <span style={metricValueStyle}>{iteration.perception_output.perception_mode || '-'}</span>
            </div>
            <div style={metricStyle}>
              <span style={metricLabelStyle}>感知置信度</span>
              <span style={metricValueStyle}>{formatConfidence(iteration.perception_output.perception_confidence)}</span>
            </div>
            <div style={metricStyle}>
              <span style={metricLabelStyle}>感知延迟</span>
              <span style={metricValueStyle}>{formatDuration(iteration.perception_output.perception_latency_ms)}</span>
            </div>
          </div>
          {iteration.perception_output.perceived_fault_elements?.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '13px', color: '#8b98a5', marginBottom: '8px' }}>故障元素</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {iteration.perception_output.perceived_fault_elements.map(el => (
                  <span key={el} style={{ 
                    padding: '4px 12px', 
                    background: '#f4212e20', 
                    color: '#f4212e', 
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}>{el}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {iteration.eval_output && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>评估输出</h2>
          <div style={gridStyle}>
            <div style={metricStyle}>
              <span style={metricLabelStyle}>准确率</span>
              <span style={{ ...metricValueStyle, color: getAccuracyColor(iteration.eval_output.accuracy ?? 0) }}>
                {formatPercent(iteration.eval_output.accuracy ?? 0)}
              </span>
            </div>
            <div style={metricStyle}>
              <span style={metricLabelStyle}>是否正确</span>
              <span style={metricValueStyle}>{iteration.eval_output.is_correct ? '是' : '否'}</span>
            </div>
          </div>
          {iteration.eval_output.optimization_suggestions?.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h3 style={{ fontSize: '13px', color: '#8b98a5', marginBottom: '8px' }}>优化建议</h3>
              <div style={listStyle}>
                {iteration.eval_output.optimization_suggestions.map((s, i) => (
                  <div key={i} style={listItemStyle}>{s}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {iteration.cases?.length > 0 && (
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>相关案例</h2>
          <div style={casesGridStyle}>
            {iteration.cases.map(c => (
              <CaseCard key={c.case_id} caseData={c} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
