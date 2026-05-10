import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCases, useCase, useCaseReasoning } from '../hooks/useApi'
import CaseCard from '../components/CaseCard'
import ReasoningTraceView from '../components/ReasoningTraceView'
import ConfidenceGauge from '../components/ConfidenceGauge'
import { formatDuration, formatPercent, formatConfidence } from '../utils/formatters'
import { getModeLabel, getSourceLabel, getAccuracyColor } from '../utils/constants'

export default function CaseLibrary() {
  const [searchParams] = useSearchParams()
  const selectedCaseId = searchParams.get('case')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [page, setPage] = useState(1)
  const perPage = 9

  const filters = {}
  if (searchQuery) filters.search = searchQuery
  if (filterSource) filters.source = filterSource
  if (filterTag) filters.tag = filterTag

  const { data: casesData, loading, error } = useCases({ ...filters, page, per_page: perPage })
  const { data: selectedCase } = useCase(selectedCaseId)
  const { data: reasoning } = useCaseReasoning(selectedCaseId)

  if (loading && !casesData) {
    return <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>加载中...</div>
  }

  if (error) {
    return (
      <div style={{ color: '#f4212e', padding: '40px', textAlign: 'center' }}>
        加载失败: {error}
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

  const searchInputStyle = {
    padding: '10px 16px',
    borderRadius: '8px',
    border: '1px solid #2f3336',
    background: '#1a1f25',
    color: '#e7e9ea',
    fontSize: '14px',
    width: '280px'
  }

  const filtersStyle = {
    display: 'flex',
    gap: '12px',
    alignItems: 'center'
  }

  const filterSelectStyle = {
    padding: '8px 12px',
    borderRadius: '6px',
    border: '1px solid #2f3336',
    background: '#1a1f25',
    color: '#e7e9ea',
    fontSize: '13px',
    cursor: 'pointer'
  }

  const layoutStyle = selectedCaseId ? {
    display: 'grid',
    gridTemplateColumns: '1fr 400px',
    gap: '24px'
  } : {}

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

  const detailHeaderStyle = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '20px'
  }

  const caseIdStyle = {
    fontSize: '18px',
    fontWeight: '700',
    color: '#e7e9ea',
    fontFamily: 'monospace'
  }

  const closeBtnStyle = {
    color: '#8b98a5',
    textDecoration: 'none',
    fontSize: '14px',
    cursor: 'pointer'
  }

  const detailGridStyle = {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px'
  }

  const detailItemStyle = {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }

  const detailLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const detailValueStyle = {
    fontSize: '14px',
    color: '#e7e9ea'
  }

  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px'
  }

  const paginationStyle = {
    display: 'flex',
    justifyContent: 'center',
    gap: '8px',
    marginTop: '24px'
  }

  const pageBtnStyle = (active) => ({
    padding: '8px 16px',
    borderRadius: '6px',
    border: '1px solid #2f3336',
    background: active ? '#1d9bf0' : '#1a1f25',
    color: active ? '#fff' : '#8b98a5',
    cursor: 'pointer',
    fontSize: '13px'
  })

  const cases = casesData?.cases || []
  const totalPages = Math.ceil((casesData?.total || 0) / perPage)

  const DetailPanel = () => {
    if (!selectedCase) {
      return (
        <div style={{ ...sectionStyle, textAlign: 'center', color: '#8b98a5', padding: '60px 20px' }}>
          选择一个案例查看详情
        </div>
      )
    }

    return (
      <div style={sectionStyle}>
        <div style={detailHeaderStyle}>
          <div style={caseIdStyle}>案例 {selectedCase.case_id}</div>
          <Link to="/case-library" style={closeBtnStyle}>关闭</Link>
        </div>
        <div style={detailGridStyle}>
          <div style={detailItemStyle}>
            <span style={detailLabelStyle}>迭代</span>
            <span style={detailValueStyle}>#{selectedCase.iteration}</span>
          </div>
          <div style={detailItemStyle}>
            <span style={detailLabelStyle}>来源</span>
            <span style={detailValueStyle}>{getSourceLabel(selectedCase.source)}</span>
          </div>
          <div style={detailItemStyle}>
            <span style={detailLabelStyle}>感知模式</span>
            <span style={detailValueStyle}>{getModeLabel(selectedCase.perception_mode)}</span>
          </div>
          <div style={detailItemStyle}>
            <span style={detailLabelStyle}>准确率</span>
            <span style={{ ...detailValueStyle, color: getAccuracyColor(selectedCase.accuracy ?? 0) }}>
              {formatPercent(selectedCase.accuracy)}
            </span>
          </div>
        </div>
        <div style={{ marginTop: '20px' }}>
          <div style={detailLabelStyle}>置信度</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '8px' }}>
            <ConfidenceGauge confidence={selectedCase.perception_confidence} size={100} />
            <div>
              <div style={{ ...detailValueStyle, fontSize: '20px', fontWeight: '600' }}>
                {formatConfidence(selectedCase.perception_confidence)}
              </div>
              <div style={{ color: '#8b98a5', fontSize: '12px', marginTop: '4px' }}>
                感知延迟: {formatDuration(selectedCase.perception_latency_ms)}
              </div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: '20px' }}>
          <div style={detailLabelStyle}>感知故障元素</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {(selectedCase.perceived_fault_elements || []).map(el => (
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
        {selectedCase.eval_feedback && (
          <div style={{ marginTop: '20px' }}>
            <div style={detailLabelStyle}>评估反馈</div>
            <div style={{
              marginTop: '8px',
              padding: '12px',
              background: '#0f1419',
              borderRadius: '8px',
              fontSize: '13px',
              color: '#8b98a5',
            }}>
              {selectedCase.eval_feedback}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>案例库</h1>
        <div style={filtersStyle}>
          <input
            style={searchInputStyle}
            placeholder="搜索案例..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <select
            style={filterSelectStyle}
            value={filterSource}
            onChange={e => setFilterSource(e.target.value)}
          >
            <option value="">全部来源</option>
            <option value="generated">生成</option>
            <option value="perception">感知</option>
            <option value="manual">手动</option>
          </select>
        </div>
      </div>
      <div style={layoutStyle}>
        <div style={sectionStyle}>
          <h2 style={sectionTitleStyle}>案例列表</h2>
          {cases.length === 0 ? (
            <div style={{ color: '#8b98a5', padding: '40px', textAlign: 'center' }}>
              暂无案例
            </div>
          ) : (
            <>
              <div style={gridStyle}>
                {cases.map(c => (
                  <CaseCard key={c.case_id} caseData={c} />
                ))}
              </div>
              {totalPages > 1 && (
                <div style={paginationStyle}>
                  <button
                    style={pageBtnStyle(false)}
                    onClick={() => setPage(p => Math.max(1, p - 1))}
                  >
                    上一页
                  </button>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    const p = Math.max(1, Math.min(totalPages - 4, page - 2)) + i
                    return (
                      <button
                        key={p}
                        style={pageBtnStyle(p === page)}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    )
                  })}
                  <button
                    style={pageBtnStyle(false)}
                    onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        {selectedCaseId && (
          <div>
            <DetailPanel />
            {reasoning && reasoning.steps && reasoning.steps.length > 0 && (
              <div style={{ ...sectionStyle, marginTop: '16px' }}>
                <h3 style={sectionTitleStyle}>推理过程</h3>
                <ReasoningTraceView steps={reasoning.steps} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
