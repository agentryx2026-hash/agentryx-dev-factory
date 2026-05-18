import React, { useEffect, useState } from 'react';

/**
 * Replay — Phase 13-B Tier B (read-only visualization).
 *
 * Lists past pipeline runs (by run_id) collected from the agent-workspace,
 * and renders a timeline of artifacts when a run is opened. Each artifact
 * shows: kind, agent, model, node, parent links, cost, latency. Click an
 * artifact to inspect it; the parent_ids draw an implicit DAG.
 *
 * Empty until Phase 6-B (USE_ARTIFACT_STORE flag) flips on — pipeline runs
 * don't write replayable artifacts today. The page surfaces that clearly
 * so the empty state doesn't look broken.
 *
 * What's NOT here (deferred to full 13-B):
 *   - Default LLM stub (re-invoke an agent during replay) — needs OpenRouter
 *   - Substitution mode (replay with frozen vs fresh inputs)
 *   - Cross-pipeline replay
 *   - HTTP endpoint to LAUNCH a replay
 *
 * Backend: /api/factory-admin/replay/{runs, runs/:id}.
 */

interface ArtifactNode {
  id: string;
  kind: string;
  run_id: string;
  agent: string;
  model?: string;
  node?: string;
  parent_ids: string[];
  produced_at: string;
  cost_usd?: number;
  latency_ms?: number;
}
interface RunSnapshot {
  run_id: string;
  project_id: string;
  artifacts: ArtifactNode[];
  agents: string[];
  window: { from: string; to: string };
}

const Replay: React.FC = () => {
  const [runs, setRuns] = useState<{ id: string }[]>([]);
  const [meta, setMeta] = useState<{ note?: string; flag_required?: string; workspace?: string } | null>(null);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [openArtifact, setOpenArtifact] = useState<ArtifactNode | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/telemetry/factory-admin/replay/runs')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`runs returned ${r.status}`)))
      .then(d => { setRuns(d.runs || []); setMeta({ note: d.note, flag_required: d.flag_required, workspace: d.workspace }); })
      .catch(e => setErr(e?.message || 'failed'))
      .finally(() => setLoading(false));
  }, []);

  const openRun = async (id: string) => {
    setOpenRunId(id);
    setSnapshot(null);
    setOpenArtifact(null);
    try {
      const r = await fetch(`/telemetry/factory-admin/replay/runs/${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'load failed');
      setSnapshot(d.snapshot);
    } catch (e: any) { setErr(e?.message || 'failed to load run'); }
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">🎬 Replay</h1>
          <p className="page-subtitle">Phase 13-B Tier B — past pipeline runs · timeline visualization · artifact inspector</p>
        </div>
      </div>

      {err && <div style={errorBar}>{err}</div>}

      {/* Empty-state info banner */}
      {!loading && runs.length === 0 && meta?.note && (
        <div style={{ marginBottom: 20, padding: 14, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fbbf24' }}>
          <strong>📦 No replayable runs yet.</strong>
          <p style={{ color: '#cbd5e1', fontSize: '0.85rem', marginTop: 6, lineHeight: 1.6 }}>{meta.note}</p>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 6 }}>
            Workspace scanned: <code style={inlineCode}>{meta.workspace}</code>. Replay activates automatically once <code style={inlineCode}>{meta.flag_required}</code> flips on (toggle from Admin → Flags) and the next pipeline run completes.
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: openRunId ? '320px 1fr' : '1fr', gap: 20 }}>
        {/* Run list */}
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📜 Past runs ({runs.length})</h3>
          </div>
          <div className="panel-body" style={{ maxHeight: 600, overflowY: 'auto' }}>
            {loading && <p style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>Loading…</p>}
            {!loading && runs.length === 0 && <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 24 }}>(empty — see banner above)</p>}
            {runs.map(r => (
              <div
                key={r.id}
                onClick={() => openRun(r.id)}
                style={{
                  padding: '10px 12px',
                  marginBottom: 6,
                  borderRadius: 6,
                  background: openRunId === r.id ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.3)',
                  border: openRunId === r.id ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  color: '#e2e8f0',
                }}
              >
                <code style={{ fontFamily: 'monospace', color: '#fbbf24' }}>{r.id}</code>
              </div>
            ))}
          </div>
        </div>

        {/* Run detail (timeline) */}
        {openRunId && (
          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">🕐 Run timeline</h3>
              {snapshot && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{snapshot.artifacts.length} artifacts · {snapshot.agents.length} agents</span>}
            </div>
            <div className="panel-body">
              {!snapshot && <p style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>Loading run…</p>}
              {snapshot && (
                <>
                  <div style={{ marginBottom: 14, padding: 10, background: 'rgba(0,0,0,0.3)', borderRadius: 6, fontSize: '0.78rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
                      <div><span style={{ color: '#64748b' }}>Project:</span> <code style={inlineCode}>{snapshot.project_id}</code></div>
                      <div><span style={{ color: '#64748b' }}>Run window:</span> <span style={{ color: '#cbd5e1' }}>{new Date(snapshot.window.from).toLocaleString()} → {new Date(snapshot.window.to).toLocaleString()}</span></div>
                      <div><span style={{ color: '#64748b' }}>Agents:</span> <span style={{ color: '#cbd5e1' }}>{snapshot.agents.join(', ')}</span></div>
                      <div><span style={{ color: '#64748b' }}>Total cost:</span> <span style={{ color: '#34d399' }}>${snapshot.artifacts.reduce((s, a) => s + (a.cost_usd ?? 0), 0).toFixed(4)}</span></div>
                    </div>
                  </div>

                  <h4 style={{ color: '#a855f7', marginBottom: 8, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Artifacts (chronological)</h4>
                  {snapshot.artifacts.map(a => {
                    const isOpen = openArtifact?.id === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={() => setOpenArtifact(isOpen ? null : a)}
                        style={{
                          padding: '10px 12px',
                          marginBottom: 6,
                          background: isOpen ? 'rgba(168,85,247,0.1)' : 'rgba(0,0,0,0.25)',
                          border: isOpen ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.04)',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                          <code style={{ ...inlineCode, fontSize: '0.78rem' }}>{a.id}</code>
                          <span style={agentPill(a.agent)}>{a.agent}</span>
                          <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>{a.kind}</span>
                          {a.node && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>· {a.node}</span>}
                          <span style={{ color: '#64748b', fontSize: '0.7rem', marginLeft: 'auto' }}>{new Date(a.produced_at).toLocaleTimeString()}</span>
                        </div>
                        {isOpen && (
                          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, fontSize: '0.75rem' }}>
                            <div><span style={{ color: '#64748b' }}>Model:</span> <code style={inlineCode}>{a.model || '—'}</code></div>
                            <div><span style={{ color: '#64748b' }}>Cost:</span> <span style={{ color: '#34d399' }}>${(a.cost_usd ?? 0).toFixed(4)}</span></div>
                            <div><span style={{ color: '#64748b' }}>Latency:</span> <span style={{ color: '#cbd5e1' }}>{a.latency_ms != null ? `${a.latency_ms}ms` : '—'}</span></div>
                            <div><span style={{ color: '#64748b' }}>Parents:</span> <span style={{ color: '#cbd5e1' }}>{a.parent_ids.length === 0 ? '(root)' : a.parent_ids.join(', ')}</span></div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <div style={{ color: '#475569', fontSize: '0.7rem', textAlign: 'center', padding: 20 }}>
        Read-only in Tier B. Re-execute / substitution / cross-pipeline replay arrives with full 13-B (needs OpenRouter credit).
      </div>
    </div>
  );
};

const errorBar: React.CSSProperties = { padding: 10, marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, color: '#f87171', fontSize: '0.8rem' };
const inlineCode: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: '#fbbf24', fontFamily: 'monospace' };

function agentPill(agent: string): React.CSSProperties {
  // Color-code agents so the timeline is visually scannable.
  const map: Record<string, string> = {
    picard: '#a855f7', sisko: '#3b82f6', troi: '#ec4899', jane: '#06b6d4',
    spock: '#f59e0b', torres: '#ef4444', tuvok: '#10b981', data: '#8b5cf6',
    crusher: '#06b6d4', obrien: '#f97316', genovi: '#84cc16', seven: '#22d3ee',
  };
  const color = map[agent?.toLowerCase()] || '#94a3b8';
  return {
    background: `${color}33`,
    color,
    padding: '1px 8px',
    borderRadius: 100,
    fontSize: '0.65rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  };
}

export default Replay;
