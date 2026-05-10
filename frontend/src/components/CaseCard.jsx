import React from 'react'
import { Link } from 'react-router-dom'
import { formatDate, formatConfidence, formatPercent, parseTags } from '../utils/formatters'
import { getStatusColor, getStatusLabel, getModeLabel, getSourceLabel, getAccuracyColor, getTagColor } from '../utils/constants'

export default function CaseCard({ caseData }) {
  const {
    case_id,
    iteration,
    source,
    perceived_fault_elements = [],
    perceived_fault_links = [],
    perception_confidence,
    perception_mode,
    perception_reasoning = [],
    accuracy,
    is_correct,
    eval_feedback,
    tags = [],
    created_at,
    perception_latency_ms
  } = caseData

  const cardStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '20px',
    transition: 'all 0.2s'
  }

  const headerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px'
  }

  const caseIdStyle = {
    fontSize: '14px',
    fontWeight: '600',
    color: '#e7e9ea',
    fontFamily: 'monospace'
  }

  const iterationBadgeStyle = {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '4px',
    background: '#1d9bf020',
    color: '#1d9bf0'
  }

  const statusBadgeStyle = {
    fontSize: '11px',
    padding: '2px 8px',
    borderRadius: '4px',
    background: is_correct ? '#00ba7c20' : '#f4212e20',
    color: is_correct ? '#00ba7c' : '#f4212e'
  }

  const sectionStyle = {
    marginBottom: '12px'
  }

  const labelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const valueStyle = {
    fontSize: '13px',
    color: '#e7e9ea'
  }

  const tagsContainerStyle = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    marginTop: '12px'
  }

  const tagStyle = (tag) => ({
    fontSize: '10px',
    padding: '2px 8px',
    borderRadius: '4px',
    background: `${getTagColor(tag)}20`,
    color: getTagColor(tag)
  })

  const footerStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '16px',
    paddingTop: '16px',
    borderTop: '1px solid #2f3336'
  }

  const latencyStyle = {
    fontSize: '12px',
    color: '#8b98a5'
  }

  const linkStyle = {
    color: '#1d9bf0',
    textDecoration: 'none',
    fontSize: '13px'
  }

  const faultElementsStr = perceived_fault_elements.length > 0 
    ? perceived_fault_elements.join(', ') 
    : '-'

  const parsedTags = parseTags(tags)

  return (
    <div style={cardStyle}>
      <div style={headerStyle}>
        <div>
          <div style={caseIdStyle}>Case {case_id}</div>
          <div style={{ ...iterationBadgeStyle, marginTop: '4px' }}>
            迭代 {iteration}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <span style={statusBadgeStyle}>
            {is_correct ? '正确' : '错误'}
          </span>
        </div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>感知模式</div>
        <div style={valueStyle}>{getModeLabel(perception_mode) || perception_mode || '-'}</div>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>故障元素</div>
        <div style={valueStyle}>{faultElementsStr}</div>
      </div>

      {perception_confidence != null && (
        <div style={sectionStyle}>
          <div style={labelStyle}>置信度</div>
          <div style={{ ...valueStyle, color: perception_confidence >= 0.85 ? '#00ba7c' : perception_confidence >= 0.5 ? '#ffad1f' : '#f4212e' }}>
            {formatConfidence(perception_confidence)}
          </div>
        </div>
      )}

      {accuracy != null && (
        <div style={sectionStyle}>
          <div style={labelStyle}>准确率</div>
          <div style={{ ...valueStyle, color: getAccuracyColor(accuracy) }}>
            {formatPercent(accuracy)}
          </div>
        </div>
      )}

      {parsedTags.length > 0 && (
        <div style={tagsContainerStyle}>
          {parsedTags.map(tag => (
            <span key={tag} style={tagStyle(tag)}>{tag}</span>
          ))}
        </div>
      )}

      <div style={footerStyle}>
        <span style={latencyStyle}>
          {created_at ? formatDate(created_at) : ''}
          {perception_latency_ms ? ` • ${perception_latency_ms.toFixed(0)}ms` : ''}
        </span>
        <Link to={`/case-library?case=${case_id}`} style={linkStyle}>
          查看详情 →
        </Link>
      </div>
    </div>
  )
}
