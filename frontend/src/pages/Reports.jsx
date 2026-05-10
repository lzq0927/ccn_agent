import React from 'react'
import { useEvaluatorSuggestions, useSkillDiffs, useIterations } from '../hooks/useApi'
import { formatDate, formatPercent, formatConfidence } from '../utils/formatters'
import { getAccuracyColor } from '../utils/constants'

export default function Reports() {
  const { data: suggestions, loading: suggestionsLoading } = useEvaluatorSuggestions()
  const { data: skillDiffs, loading: diffsLoading } = useSkillDiffs()
  const { data: iterations, loading: iterationsLoading } = useIterations()

  if (suggestionsLoading || diffsLoading || iterationsLoading) {
    return <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>加载中...</div>
  }

  const containerStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px'
  }

  const titleStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea'
  }

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

  const statGridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px'
  }

  const statCardStyle = {
    background: '#0f1419',
    borderRadius: '8px',
    padding: '20px'
  }

  const statLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const statValueStyle = {
    fontSize: '28px',
    fontWeight: '700',
    color: '#e7e9ea',
    marginTop: '8px'
  }

  const listStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px'
  }

  const listItemStyle = {
    padding: '16px',
    background: '#0f1419',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }

  const suggestionTypeStyle = (type) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: '600',
    textTransform: 'uppercase'
  })

  const tableStyle = {
    width: '100%',
    borderCollapse: 'collapse'
  }

  const thStyle = {
    textAlign: 'left',
    padding: '12px 16px',
    borderBottom: '1px solid #2f3336',
    fontSize: '12px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const tdStyle = {
    padding: '12px 16px',
    borderBottom: '1px solid #2f3336',
    fontSize: '14px',
    color: '#e7e9ea'
  }

  const tagStyle = (color) => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '11px',
    background: `${color}20`,
    color: color
  })

  const chartContainerStyle = {
    marginTop: '16px',
    padding: '20px',
    background: '#0f1419',
    borderRadius: '8px'
  }

  const barStyle = (value, color) => ({
    height: '24px',
    width: `${value * 100}%`,
    background: color,
    borderRadius: '4px',
    transition: 'width 0.3s ease'
  })

  const accuracyTrend = iterations?.slice(0, 10).reverse().map(iter => ({
    iteration: iter.iteration,
    accuracy: iter.perception_accuracy || 0
  })) || []

  const maxAccuracy = Math.max(...accuracyTrend.map(t => t.accuracy), 0.01)

  return (
    <div style={containerStyle}>
      <div>
        <h1 style={titleStyle}>评估报告</h1>
        <p style={{ color: '#8b98a5', marginTop: '4px', fontSize: '14px' }}>
          系统性能分析和优化建议
        </p>
      </div>

      <div style={statGridStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>总案例数</div>
          <div style={statValueStyle}>{suggestions?.total_cases || 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>本周准确率</div>
          <div style={{ ...statValueStyle, color: getAccuracyColor(suggestions?.weekly_accuracy || 0) }}>
            {formatPercent(suggestions?.weekly_accuracy || 0)}
          </div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>优化建议</div>
          <div style={statValueStyle}>{suggestions?.suggestions?.length || 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>Skill更新</div>
          <div style={statValueStyle}>{skillDiffs?.length || 0}</div>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>准确率趋势（最近10次迭代）</h2>
        <div style={chartContainerStyle}>
          {accuracyTrend.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {accuracyTrend.map((item, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <span style={{ width: '60px', fontSize: '13px', color: '#8b98a5' }}>
                    #{item.iteration}
                  </span>
                  <div style={{ flex: 1, background: '#2f3336', borderRadius: '4px', height: '24px' }}>
                    <div style={barStyle(item.accuracy / maxAccuracy, getAccuracyColor(item.accuracy))} />
                  </div>
                  <span style={{ width: '50px', fontSize: '13px', color: '#e7e9ea', textAlign: 'right' }}>
                    {formatPercent(item.accuracy)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: '#8b98a5', padding: '40px' }}>
              暂无迭代数据
            </div>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>最新优化建议</h2>
        <div style={listStyle}>
          {(suggestions?.suggestions || []).slice(0, 10).map((s, idx) => (
            <div key={idx} style={listItemStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{
                    ...suggestionTypeStyle(s.type),
                    background: s.type === 'skill' ? '#9c27b020' : s.type === 'prompt' ? '#1d9bf020' : '#ff980020',
                    color: s.type === 'skill' ? '#9c27b0' : s.type === 'prompt' ? '#1d9bf0' : '#ff9800'
                  }}>
                    {s.type}
                  </span>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: '#e7e9ea' }}>
                    {s.title || s.skill_name || '优化建议'}
                  </span>
                </div>
                <span style={{ fontSize: '12px', color: '#8b98a5' }}>
                  {formatDate(s.created_at)}
                </span>
              </div>
              <p style={{ fontSize: '13px', color: '#8b98a5', lineHeight: '1.6' }}>
                {s.description || s.content}
              </p>
              {s.affected_cases && (
                <div style={{ fontSize: '12px', color: '#8b98a5' }}>
                  影响案例: {s.affected_cases} 个
                </div>
              )}
            </div>
          ))}
          {(!suggestions?.suggestions || suggestions.suggestions.length === 0) && (
            <div style={{ textAlign: 'center', color: '#8b98a5', padding: '40px' }}>
              暂无优化建议
            </div>
          )}
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>Skill 变更历史</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Skill名称</th>
              <th style={thStyle}>版本</th>
              <th style={thStyle}>变更类型</th>
              <th style={thStyle}>变更时间</th>
              <th style={thStyle}>摘要</th>
            </tr>
          </thead>
          <tbody>
            {(skillDiffs || []).map((diff, idx) => (
              <tr key={idx}>
                <td style={tdStyle}>{diff.skill_name}</td>
                <td style={tdStyle}>v{diff.version}</td>
                <td style={tdStyle}>
                  <span style={tagStyle(
                    diff.change_type === 'added' ? '#00ba7c' : 
                    diff.change_type === 'modified' ? '#1d9bf0' : '#f4212e'
                  )}>
                    {diff.change_type}
                  </span>
                </td>
                <td style={tdStyle}>{formatDate(diff.created_at)}</td>
                <td style={tdStyle}>{diff.summary || '-'}</td>
              </tr>
            ))}
            {(!skillDiffs || skillDiffs.length === 0) && (
              <tr>
                <td colSpan="5" style={{ ...tdStyle, textAlign: 'center', color: '#8b98a5' }}>
                  暂无变更记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={sectionStyle}>
        <h2 style={sectionTitleStyle}>性能指标</h2>
        <div style={statGridStyle}>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>平均感知延迟</div>
            <div style={statValueStyle}>{(suggestions?.avg_latency_ms || 0).toFixed(0)}ms</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>高置信度占比</div>
            <div style={statValueStyle}>{formatPercent(suggestions?.high_confidence_ratio || 0)}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>Skill模式占比</div>
            <div style={statValueStyle}>{formatPercent(suggestions?.skill_mode_ratio || 0)}</div>
          </div>
          <div style={statCardStyle}>
            <div style={statLabelStyle}>案例增长率</div>
            <div style={statValueStyle}>{formatPercent(suggestions?.case_growth_rate || 0)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
