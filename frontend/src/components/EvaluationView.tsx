import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { Suggestion } from '../api/types';

const cardStyle: React.CSSProperties = { background: '#fff', borderRadius: 8, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };

export default function EvaluationView() {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [progress, setProgress] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const [sugs, prog] = await Promise.all([
      api.evaluation.suggestions(),
      api.evaluation.loopProgress(),
    ]);
    setSuggestions(sugs);
    setProgress(prog);
  };

  const applySuggestion = async (id: number) => {
    await api.evaluation.applySuggestion(id);
    loadData();
  };

  return (
    <div>
      {/* Loop Progress */}
      {progress && (
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Loop Progress</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Total Cases</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{progress.total_cases as number}</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Accuracy</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{((progress.overall_accuracy as number) * 100).toFixed(1)}%</div>
            </div>
            <div style={{ background: '#f9fafb', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Evaluations</div>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{progress.total_evaluations as number}</div>
            </div>
          </div>
        </div>
      )}

      {/* Optimization Suggestions */}
      <div style={cardStyle}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Optimization Suggestions ({suggestions.length})</h3>
        {suggestions.length === 0 ? (
          <div style={{ color: '#9ca3af', fontSize: 13 }}>No suggestions yet. Run evaluations to generate optimization feedback.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {suggestions.map(s => (
              <div key={s.id} style={{ background: '#f9fafb', borderRadius: 6, padding: 12, borderLeft: `3px solid ${s.status === 'pending' ? '#f59e0b' : '#16a34a'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontSize: 11, background: '#eef2ff', color: '#4f46e5', padding: '2px 6px', borderRadius: 4 }}>
                      {s.suggestion_type}
                    </span>
                    <span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>Target: {s.target}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, color: '#6b7280' }}>Priority: {s.priority.toFixed(2)}</span>
                    {s.status === 'pending' && (
                      <button onClick={() => applySuggestion(s.id)} style={{ padding: '4px 8px', fontSize: 11, background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                        Apply
                      </button>
                    )}
                    {s.status === 'applied' && <span style={{ fontSize: 11, color: '#16a34a' }}>Applied</span>}
                  </div>
                </div>
                <div style={{ fontSize: 13, marginTop: 8, color: '#374151' }}>{s.suggestion_content}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
