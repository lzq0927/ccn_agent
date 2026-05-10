import React, { useState } from 'react';
import { api } from '../api/client';
import type { CaseInfo } from '../api/types';

const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };

export default function DataGenView() {
  const [cases, setCases] = useState<CaseInfo[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [batchStatus, setBatchStatus] = useState<string>('');

  const loadCases = async () => {
    setLoading(true);
    try {
      const res = await api.generation.listCases(1, 50);
      setCases(res.cases);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  };

  const startBatch = async () => {
    const res = await api.generation.startBatch(20);
    setBatchStatus(`Batch ${res.batch_id} started`);
    // Poll for completion
    const poll = setInterval(async () => {
      const status = await api.generation.getBatch(res.batch_id);
      setBatchStatus(`Batch ${res.batch_id}: ${status.completed}/${res.count} completed`);
      if (status.status === 'completed') {
        clearInterval(poll);
        setBatchStatus(`Batch ${res.batch_id}: Complete!`);
        loadCases();
      }
    }, 2000);
  };

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        <button onClick={startBatch} style={{ padding: '8px 16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          Generate 20 Cases
        </button>
        <button onClick={loadCases} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
          Refresh Cases
        </button>
        {batchStatus && <span style={{ padding: '8px 0', fontSize: 13, color: '#6b7280' }}>{batchStatus}</span>}
      </div>

      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Cases ({total})</h3>
        {loading ? <div>Loading...</div> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>ID</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Fault Type</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Mode</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Difficulty</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Validation</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {cases.map(c => (
                <tr key={c.case_id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 8 }}>{c.case_id}</td>
                  <td style={{ padding: 8 }}>{c.fault_type || '-'}</td>
                  <td style={{ padding: 8 }}>{c.fault_mode || '-'}</td>
                  <td style={{ padding: 8 }}>{c.difficulty || '-'}</td>
                  <td style={{ padding: 8 }}>
                    <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: c.validation_status === 'passed' ? '#dcfce7' : '#fef2f2', color: c.validation_status === 'passed' ? '#16a34a' : '#dc2626' }}>
                      {c.validation_status}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>{c.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
