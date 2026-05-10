import React, { useState } from 'react';
import { api } from '../api/client';
import type { SessionInfo, ReasoningStep } from '../api/types';

const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };

export default function FaultPerceptionView() {
  const [caseId, setCaseId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [session, setSession] = useState<(SessionInfo & { reasoning_steps?: ReasoningStep[] }) | null>(null);
  const [history, setHistory] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);

  const diagnose = async () => {
    if (!caseId) return;
    setLoading(true);
    try {
      const res = await api.perception.diagnose(Number(caseId));
      setSessionId(res.session_id);
    } finally {
      setLoading(false);
    }
  };

  const loadSession = async () => {
    if (!sessionId) return;
    try {
      const s = await api.perception.getSession(sessionId);
      setSession(s);
    } catch { /* not found */ }
  };

  const loadHistory = async () => {
    const res = await api.perception.history(1);
    setHistory(res.sessions);
  };

  return (
    <div>
      {/* Diagnose Form */}
      <div style={{ ...cardStyle, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center' }}>
        <input
          type="number"
          placeholder="Case ID"
          value={caseId}
          onChange={e => setCaseId(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, width: 120 }}
        />
        <button onClick={diagnose} disabled={loading} style={{ padding: '8px 16px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
          {loading ? 'Starting...' : 'Diagnose'}
        </button>
        {sessionId && (
          <>
            <span style={{ fontSize: 13, color: '#6b7280' }}>Session: {sessionId}</span>
            <button onClick={loadSession} style={{ padding: '6px 12px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer' }}>
              Load Result
            </button>
          </>
        )}
        <button onClick={loadHistory} style={{ padding: '8px 16px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', marginLeft: 'auto' }}>
          Load History
        </button>
      </div>

      {/* Session Result */}
      {session && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Diagnosis Result</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
            <div><span style={{ fontSize: 12, color: '#6b7280' }}>Fault Type</span><div style={{ fontWeight: 600 }}>{session.fault_type_predicted || '-'}</div></div>
            <div><span style={{ fontSize: 12, color: '#6b7280' }}>Route</span><div style={{ fontWeight: 600 }}>{session.route_taken}</div></div>
            <div><span style={{ fontSize: 12, color: '#6b7280' }}>Confidence</span><div style={{ fontWeight: 600 }}>{session.final_confidence?.toFixed(3)}</div></div>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>Predicted Elements: {session.fault_elements_predicted}</div>
          {session.status && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Status: {session.status}</div>}

          {/* Reasoning Trace */}
          {session.reasoning_steps && session.reasoning_steps.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ fontSize: 14 }}>Reasoning Trace</h4>
              <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12, maxHeight: 300, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
                {session.reasoning_steps.map((step, i) => (
                  <div key={i} style={{ padding: '4px 0', borderBottom: '1px solid #e5e7eb' }}>
                    <span style={{ color: step.step_type === 'tool_call' ? '#4f46e5' : step.step_type === 'conclusion' ? '#16a34a' : '#6b7280' }}>
                      [{step.step_number}] {step.step_type}
                    </span>
                    {step.tool_name && <span style={{ color: '#4f46e5' }}> {step.tool_name}</span>}
                    <div style={{ color: '#374151', marginTop: 2 }}>{step.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div style={cardStyle}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Diagnosis History</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 8 }}>Session</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Case</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Route</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Fault Type</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Confidence</th>
                <th style={{ textAlign: 'left', padding: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {history.map(s => (
                <tr key={s.session_id} style={{ borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }} onClick={() => { setSessionId(s.session_id); loadSession(); }}>
                  <td style={{ padding: 8 }}>{s.session_id.slice(0, 12)}</td>
                  <td style={{ padding: 8 }}>{s.case_id}</td>
                  <td style={{ padding: 8 }}>{s.route_taken}</td>
                  <td style={{ padding: 8 }}>{s.fault_type_predicted || '-'}</td>
                  <td style={{ padding: 8 }}>{s.final_confidence?.toFixed(3)}</td>
                  <td style={{ padding: 8 }}>{s.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
