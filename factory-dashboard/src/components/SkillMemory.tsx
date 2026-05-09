import React, { useEffect, useState } from 'react';

/**
 * Memory Layer — Phase 7-A surface (was static mock; now real).
 *
 * Lists scopes + observations from the configured memory backend (default
 * = filesystem at ~/Projects/agent-workspace/_factory-memory). Distinct
 * from the architect's KB:
 *   - Memory layer (Phase 7-A): observations / lessons / patterns /
 *     decisions / user_notes — scoped to projects or global. Long-term
 *     learning the factory accumulates across all activity.
 *   - Architect KB (Phase 21-A): findings / proposals / Standing Orders /
 *     research passes — focused on the autonomous research loop.
 *
 * Five observation kinds (Phase 7-A types.js):
 *   observation · lesson · pattern · decision · user_note
 *
 * Empty until USE_MEMORY_LAYER flag is on AND agents start writing.
 *
 * Backend: /api/factory-admin/memory/{scopes, observations}.
 */

type Kind = 'observation' | 'lesson' | 'pattern' | 'decision' | 'user_note';

const KIND_COLOR: Record<string, string> = {
  observation: '#3b82f6',
  lesson:      '#10b981',
  pattern:     '#a855f7',
  decision:    '#f59e0b',
  user_note:   '#ec4899',
};
const KIND_ICON: Record<string, string> = {
  observation: '👁',
  lesson:      '🎓',
  pattern:     '🔀',
  decision:    '⚖️',
  user_note:   '📝',
};

interface ScopeSummary { scope: string; count: number }
interface Observation {
  id: string;
  scope: string;
  kind: Kind;
  content: string;
  tags?: string[];
  refs?: any;
  provenance?: any;
  created_at?: string;
}

const SkillMemory: React.FC = () => {
  const [scopes, setScopes] = useState<ScopeSummary[]>([]);
  const [kinds, setKinds] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<{ note?: string; backend?: string; flag_required?: string }>({});
  const [activeScope, setActiveScope] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<Kind | null>(null);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncFlash, setSyncFlash] = useState<string | null>(null);

  const refreshScopes = async () => {
    try {
      const r = await fetch('/telemetry/factory-admin/memory/scopes');
      if (!r.ok) throw new Error(`scopes returned ${r.status}`);
      const d = await r.json();
      setScopes(d.scopes || []);
      setKinds(d.kinds || {});
      setTotal(d.total || 0);
      setMeta({ note: d.note, backend: d.backend, flag_required: d.flag_required });
    } catch (e: any) { setErr(e?.message || 'failed'); }
    finally { setLoading(false); }
  };
  useEffect(() => { refreshScopes(); }, []);

  const syncFromArtifacts = async () => {
    setSyncing(true);
    setSyncFlash(null);
    try {
      const r = await fetch('/telemetry/factory-admin/memory/sync-from-artifacts', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `sync returned ${r.status}`);
      setSyncFlash(`✅ Synced ${d.synced} observations (${d.skipped} skipped · ${d.artifacts_scanned} artifacts scanned · ${d.runs_processed} runs · ${d.agents_processed} agents)`);
      setTimeout(() => setSyncFlash(null), 8000);
      await refreshScopes();
    } catch (e: any) {
      setErr(e?.message || 'sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const loadObservations = async (scope: string | null, kind: Kind | null) => {
    try {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (kind) params.set('kind', kind);
      params.set('limit', '100');
      const r = await fetch(`/telemetry/factory-admin/memory/observations?${params}`);
      if (!r.ok) throw new Error(`observations returned ${r.status}`);
      const d = await r.json();
      setObservations(d.observations || []);
    } catch (e: any) { setErr(e?.message || 'failed'); }
  };

  const pickScope = (scope: string | null) => {
    setActiveScope(scope);
    loadObservations(scope, activeKind);
  };
  const pickKind = (kind: Kind | null) => {
    setActiveKind(kind);
    loadObservations(activeScope, kind);
  };

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">🧠 Memory Layer</h1>
          <p className="page-subtitle">Phase 7-A — observations / lessons / patterns / decisions / user notes (was Skill Memory)</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>backend:</span>
          <code style={inlineCode}>{meta.backend || 'filesystem'}</code>
          <button onClick={syncFromArtifacts} disabled={syncing} style={{ padding: '6px 12px', background: syncing ? 'rgba(100,116,139,0.2)' : 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none', borderRadius: 6, color: '#fff', fontSize: '0.7rem', cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: 700 }}>
            {syncing ? '🔄 Syncing…' : '🔄 Sync from artifacts'}
          </button>
          <button onClick={refreshScopes} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {syncFlash && <div style={{ padding: 10, marginBottom: 12, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', borderRadius: 6, color: '#34d399', fontSize: '0.8rem' }}>{syncFlash}</div>}
      {err && <div style={errorBar}>{err}</div>}

      {/* Empty-state banner */}
      {!loading && total === 0 && meta.note && (
        <div style={{ marginBottom: 20, padding: 14, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 8, color: '#fbbf24' }}>
          <strong>🧠 No observations yet.</strong>
          <p style={{ color: '#cbd5e1', fontSize: '0.85rem', marginTop: 6, lineHeight: 1.6 }}>{meta.note}</p>
          <p style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: 6 }}>
            Five observation kinds will populate here: <strong>observation</strong> (raw signals), <strong>lesson</strong> (extracted insights), <strong>pattern</strong> (recurring shapes), <strong>decision</strong> (architectural choices), <strong>user_note</strong> (founder annotations). Flip <code style={inlineCode}>{meta.flag_required}</code> in Admin → Flags and the next pipeline run starts populating.
          </p>
        </div>
      )}

      {/* Counts strip */}
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3 className="panel-title">📊 By kind ({total} total)</h3>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
          {(['observation', 'lesson', 'pattern', 'decision', 'user_note'] as Kind[]).map(k => (
            <button
              key={k}
              onClick={() => pickKind(activeKind === k ? null : k)}
              style={{
                background: activeKind === k ? `${KIND_COLOR[k]}33` : 'rgba(0,0,0,0.3)',
                border: activeKind === k ? `1px solid ${KIND_COLOR[k]}` : '1px solid rgba(255,255,255,0.05)',
                borderRadius: 8,
                padding: '12px 10px',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{KIND_ICON[k]}</div>
              <div style={{ color: KIND_COLOR[k], fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, fontWeight: 700 }}>{k}</div>
              <div style={{ color: '#e2e8f0', fontSize: '1.1rem', fontWeight: 700, fontFamily: 'monospace' }}>{kinds[k] || 0}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20 }}>
        {/* Scope list */}
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📁 Scopes ({scopes.length})</h3>
          </div>
          <div className="panel-body">
            <div
              onClick={() => pickScope(null)}
              style={{
                padding: '8px 12px',
                marginBottom: 4,
                borderRadius: 6,
                background: activeScope === null ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.3)',
                border: activeScope === null ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.04)',
                cursor: 'pointer',
                fontSize: '0.78rem',
                color: '#cbd5e1',
              }}
            >
              <span style={{ color: '#94a3b8' }}>(all scopes) — {total}</span>
            </div>
            {scopes.map(s => (
              <div
                key={s.scope}
                onClick={() => pickScope(s.scope)}
                style={{
                  padding: '8px 12px',
                  marginBottom: 4,
                  borderRadius: 6,
                  background: activeScope === s.scope ? 'rgba(168,85,247,0.15)' : 'rgba(0,0,0,0.3)',
                  border: activeScope === s.scope ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.04)',
                  cursor: 'pointer',
                  fontSize: '0.78rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <code style={{ color: '#fbbf24', fontFamily: 'monospace' }}>{s.scope}</code>
                <span style={{ color: '#64748b' }}>{s.count}</span>
              </div>
            ))}
            {scopes.length === 0 && !loading && (
              <p style={{ color: '#64748b', fontSize: '0.78rem', textAlign: 'center', padding: 16, fontStyle: 'italic' }}>(no scopes)</p>
            )}
          </div>
        </div>

        {/* Observations panel */}
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📋 Observations</h3>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
              {activeScope ? `scope: ${activeScope}` : 'all scopes'}
              {activeKind ? ` · kind: ${activeKind}` : ''}
              {observations.length > 0 ? ` · ${observations.length} shown` : ''}
            </span>
          </div>
          <div className="panel-body">
            {loading && <p style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>Loading…</p>}
            {!loading && observations.length === 0 && (
              <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 28 }}>
                {activeScope || activeKind
                  ? `No observations match this filter. Try selecting "(all scopes)" or clearing the kind filter.`
                  : `No observations yet. Pick a scope on the left, or wait for agents to write.`}
              </p>
            )}
            {observations.map(o => {
              const isOpen = openId === o.id;
              return (
                <div
                  key={o.id}
                  onClick={() => setOpenId(isOpen ? null : o.id)}
                  style={{
                    padding: 12,
                    marginBottom: 6,
                    borderRadius: 6,
                    background: isOpen ? 'rgba(168,85,247,0.1)' : 'rgba(0,0,0,0.25)',
                    border: isOpen ? '1px solid rgba(168,85,247,0.3)' : '1px solid rgba(255,255,255,0.04)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontSize: '1rem' }}>{KIND_ICON[o.kind]}</span>
                    <span style={{ background: `${KIND_COLOR[o.kind]}33`, color: KIND_COLOR[o.kind], padding: '1px 8px', borderRadius: 100, fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase' }}>{o.kind}</span>
                    <code style={{ ...inlineCode, fontSize: '0.7rem' }}>{o.scope}</code>
                    <code style={{ ...inlineCode, fontSize: '0.7rem' }}>{o.id}</code>
                    {o.created_at && <span style={{ color: '#64748b', fontSize: '0.7rem', marginLeft: 'auto' }}>{new Date(o.created_at).toLocaleString()}</span>}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.5, whiteSpace: isOpen ? 'pre-wrap' : 'nowrap', overflow: isOpen ? 'visible' : 'hidden', textOverflow: 'ellipsis' }}>
                    {o.content}
                  </div>
                  {isOpen && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.04)', fontSize: '0.75rem' }}>
                      {o.tags && o.tags.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ color: '#64748b' }}>tags: </span>
                          {o.tags.map(t => (
                            <span key={t} style={{ background: 'rgba(255,255,255,0.05)', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, marginRight: 4, fontSize: '0.7rem' }}>{t}</span>
                          ))}
                        </div>
                      )}
                      {o.refs && Object.keys(o.refs).length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <span style={{ color: '#64748b' }}>refs: </span>
                          <code style={{ ...inlineCode, fontSize: '0.7rem' }}>{JSON.stringify(o.refs)}</code>
                        </div>
                      )}
                      {o.provenance && (
                        <div>
                          <span style={{ color: '#64748b' }}>provenance: </span>
                          <code style={{ ...inlineCode, fontSize: '0.7rem' }}>{JSON.stringify(o.provenance)}</code>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const errorBar: React.CSSProperties = { padding: 10, marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, color: '#f87171', fontSize: '0.8rem' };
const inlineCode: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: '#fbbf24', fontFamily: 'monospace' };

export default SkillMemory;
