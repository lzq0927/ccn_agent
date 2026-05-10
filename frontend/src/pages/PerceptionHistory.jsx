import React, { useState } from 'react'
import { useCases } from '../hooks/useApi'
import CaseCard from '../components/CaseCard'
import { formatPercent } from '../utils/formatters'

export default function PerceptionHistory() {
  const [page, setPage] = useState(1)
  const [filterMode, setFilterMode] = useState('')
  const [filterCorrect, setFilterCorrect] = useState('')
  const perPage = 12

  const filters = {}
  if (filterMode) filters.perception_mode = filterMode
  if (filterCorrect === 'correct') filters.is_correct = 'true'
  if (filterCorrect === 'incorrect') filters.is_correct = 'false'

  const { data: casesData, loading, error } = useCases({ ...filters, page, per_page: perPage })

  if (loading) {
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

  const statsStyle = {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '16px'
  }

  const statCardStyle = {
    background: '#1a1f25',
    border: '1px solid #2f3336',
    borderRadius: '12px',
    padding: '16px'
  }

  const statLabelStyle = {
    fontSize: '11px',
    color: '#8b98a5',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  }

  const statValueStyle = {
    fontSize: '24px',
    fontWeight: '700',
    color: '#e7e9ea',
    marginTop: '4px'
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

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <div>
          <h1 style={titleStyle}>感知历史</h1>
          <p style={{ color: '#8b98a5', marginTop: '4px', fontSize: '14px' }}>
            查看所有历史感知记录和案例分析
          </p>
        </div>
        <div style={filtersStyle}>
          <select 
            style={filterSelectStyle} 
            value={filterMode}
            onChange={e => { setFilterMode(e.target.value); setPage(1); }}
          >
            <option value="">全部模式</option>
            <option value="skill">技能模式</option>
            <option value="llm_explorer">LLM探索</option>
          </select>
          <select 
            style={filterSelectStyle}
            value={filterCorrect}
            onChange={e => { setFilterCorrect(e.target.value); setPage(1); }}
          >
            <option value="">全部结果</option>
            <option value="correct">正确</option>
            <option value="incorrect">错误</option>
          </select>
        </div>
      </div>

      <div style={statsStyle}>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>总案例数</div>
          <div style={statValueStyle}>{casesData?.total || 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>正确数</div>
          <div style={{ ...statValueStyle, color: '#00ba7c' }}>{casesData?.correct_count || 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>错误数</div>
          <div style={{ ...statValueStyle, color: '#f4212e' }}>{casesData?.incorrect_count || 0}</div>
        </div>
        <div style={statCardStyle}>
          <div style={statLabelStyle}>平均准确率</div>
          <div style={statValueStyle}>{formatPercent(casesData?.avg_accuracy || 0)}</div>
        </div>
      </div>

      <div style={gridStyle}>
        {cases.length > 0 ? (
          cases.map(c => <CaseCard key={c.case_id} caseData={c} />)
        ) : (
          <div style={{ 
            gridColumn: '1 / -1', 
            textAlign: 'center', 
            padding: '60px 20px',
            color: '#8b98a5'
          }}>
            暂无符合条件的案例
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div style={paginationStyle}>
          <button 
            style={pageBtnStyle(false)} 
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            上一页
          </button>
          {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
            const pageNum = i + 1
            return (
              <button 
                key={pageNum} 
                style={pageBtnStyle(page === pageNum)}
                onClick={() => setPage(pageNum)}
              >
                {pageNum}
              </button>
            )
          })}
          <button 
            style={pageBtnStyle(false)}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            下一页
          </button>
        </div>
      )}
    </div>
  )
}
