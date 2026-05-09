import React, { useEffect, useState } from 'react';

/**
 * Phase 21-A surface — Master Architect / Standing Orders / Founder Proposal Portal.
 *
 * One page with five sections:
 *   1. Header card: version + horizon + "Run a pass now" button
 *   2. Tab 1 (baseline): cron, budget, dispatcher, depth — what the architect does autonomously
 *   3. Tab 2 (custom_direction): 6 priority areas with weight bars + overall stance + strategic watch
 *   4. Knowledge Base summary: target/gap/finding/pass counts + findings-by-area chart
 *   5. Recent passes + Pending proposals — read with approve/reject
 *
 * Backend: /api/architect/{state,seed,run_pass,proposal/:id/:action}.
 * Architect's stub dispatcher = $0 cost; safe to invoke from the UI.
 */

const PRIORITY_AREAS = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'] as const;
type PriorityAreaId = typeof PRIORITY_AREAS[number];

const AREA_ICON: Record<PriorityAreaId, string> = {
  models: '🧠',
  agents: '🖖',
  languages: '🔤',
  tools: '🔧',
  output_quality: '✨',
  operations: '⚙️',
};

const KIND_BADGE: Record<string, { color: string; label: string }> = {
  tool_adoption:    { color: '#a855f7', label: 'Tool Adoption' },
  kb_update:        { color: '#10b981', label: 'KB Update' },
  research_finding: { color: '#3b82f6', label: 'Research Finding' },
};

const STATE_BADGE: Record<string, { color: string; label: string }> = {
  draft:      { color: '#64748b', label: 'Draft' },
  evaluating: { color: '#f59e0b', label: 'Evaluating' },
  ready:      { color: '#3b82f6', label: 'Ready' },
  approved:   { color: '#10b981', label: 'Approved' },
  rejected:   { color: '#ef4444', label: 'Rejected' },
  applied:    { color: '#a855f7', label: 'Applied' },
  superseded: { color: '#475569', label: 'Superseded' },
};

interface ArchitectState {
  standing_orders: any | null;
  summary: any;
  passes: any[];
  findings: any[];
  proposals: any[];
  kb_root: string;
  has_seed: boolean;
}

const MasterArchitect: React.FC = () => {
  const [state, setState] = useState<ArchitectState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/telemetry/architect/state');
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'failed to load architect state');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 4500);
  };

  const seed = async () => {
    setBusy('seed');
    try {
      const res = await fetch('/telemetry/architect/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `seed failed: ${res.status}`);
      flash(`✅ Standing Orders seeded (v${data.version}). The architect now has direction.`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'seed failed');
    } finally {
      setBusy(null);
    }
  };

  const runPass = async () => {
    setBusy('run_pass');
    try {
      const res = await fetch('/telemetry/architect/run_pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passKind: 'manual' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `run_pass failed: ${res.status}`);
      const findingsCount = data.findings_count ?? 0;
      const proposalsCount = data.proposals_count ?? 0;
      flash(`✅ Pass ${data.pass?.id || ''} complete — ${findingsCount} findings, ${proposalsCount} proposals (stub dispatcher · $0).`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'run pass failed');
    } finally {
      setBusy(null);
    }
  };

  const decideProposal = async (id: string, action: 'approve' | 'reject') => {
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/telemetry/architect/proposal/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewer: 'founder' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${action} failed`);
      flash(`Proposal ${id} ${action}d.`);
      await refresh();
    } catch (e: any) {
      setError(e?.message || `${action} failed`);
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header"><h1 className="page-title">Master Architect</h1></div>
        <div className="glass-panel" style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>
          Loading architect state…
        </div>
      </div>
    );
  }

  const so = state?.standing_orders;
  const cd = so?.custom_direction;
  const baseline = so?.baseline || {};
  const summary = state?.summary || {};
  const findingsByArea = summary.findings_by_area || {};
  const totalFindings = summary.finding_count || 0;
  const maxAreaFindings = Math.max(1, ...Object.values(findingsByArea).map((n: any) => Number(n) || 0));

  // ─── Empty state: no Standing Orders configured ─────────────────────
  if (!so) {
    return (
      <div className="fade-in">
        <PageHeader runPass={runPass} busy={busy} disabled />
        {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
        {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

        <div className="glass-panel" style={{ padding: 32 }}>
          <h2 style={{ color: '#fbbf24', marginBottom: 12 }}>👑 Standing Orders not configured yet</h2>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16 }}>
            <strong style={{ color: '#e2e8f0' }}>Standing Orders</strong> is the founder's permanent directive to the Master Architect — what the architect researches autonomously
            (Tab 1 <code style={inlineCode}>baseline</code>) and how the founder steers it (Tab 2 <code style={inlineCode}>custom_direction</code>: 6 weighted priority areas, ~60 fillable slots).
          </p>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 24 }}>
            The factory ships a realistic v1 example seeded from the current roadmap state (post-Phase 2.76 / Phase 21-A close).
            Click below to copy it into <code style={inlineCode}>_kb/standing_orders.json</code>; you can refine it monthly afterward.
          </p>
          <button
            onClick={seed}
            disabled={busy === 'seed' || !state?.has_seed}
            style={{
              padding: '12px 24px',
              background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontWeight: 700,
              cursor: busy === 'seed' ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              opacity: busy === 'seed' ? 0.5 : 1,
            }}
          >
            {busy === 'seed' ? 'Seeding…' : '👑 Seed Standing Orders from example (v1)'}
          </button>
          {!state?.has_seed && (
            <p style={{ color: '#ef4444', fontSize: '0.85rem', marginTop: 12 }}>
              ⚠ <code style={inlineCode}>cognitive-engine/architect/standing_orders.example.json</code> not found on the server.
            </p>
          )}
          <p style={{ color: '#64748b', fontSize: '0.8rem', marginTop: 16 }}>
            KB root: <code style={inlineCode}>{state?.kb_root}</code>
          </p>
        </div>
      </div>
    );
  }

  const areaEntries: any[] = Array.isArray(cd?.priority_areas) ? cd.priority_areas : [];
  const sortedAreas = [...areaEntries].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const totalWeight = areaEntries.reduce((acc, a) => acc + (Number(a.weight) || 0), 0) || 1;

  return (
    <div className="fade-in">
      <PageHeader runPass={runPass} busy={busy} />
      {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
      {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

      {/* ═══ Card row 1: header + KB summary ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📜 Standing Orders v{so.version}</h3>
            <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
              {cd?.effective_period?.horizon_label || '—'}
            </span>
          </div>
          <div className="panel-body">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              <Stat label="Risk" value={cd?.overall_stance?.risk_appetite || '—'} />
              <Stat label="Quality vs Speed" value={cd?.overall_stance?.quality_vs_speed || '—'} />
              <Stat label="Cost Sensitivity" value={cd?.overall_stance?.cost_sensitivity || '—'} />
              <Stat label="Change Tolerance" value={cd?.overall_stance?.change_tolerance || '—'} />
            </div>
            {cd?.notes && (
              <div style={{ marginTop: 16, padding: 12, background: 'rgba(245,158,11,0.05)', borderLeft: '3px solid rgba(245,158,11,0.5)', borderRadius: 4, color: '#cbd5e1', fontSize: '0.8rem', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                <strong style={{ color: '#fbbf24' }}>Operating notes:</strong> {cd.notes}
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-header"><h3 className="panel-title">🗂 Knowledge Base</h3></div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            <Stat label="Targets" value={summary.target_count ?? 0} mono />
            <Stat label="Gaps" value={summary.gap_count ?? 0} mono />
            <Stat label="Findings" value={totalFindings} mono />
            <Stat label="Passes" value={summary.pass_count ?? 0} mono />
          </div>
        </div>
      </div>

      {/* ═══ Tab 1: baseline ═══ */}
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3 className="panel-title">⚙️ Tab 1 — Baseline (autonomous behavior)</h3>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>edited rarely · quarterly</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Stat label="Daily cron (UTC)" value={`${pad(baseline.cron_schedule?.hour_utc ?? 0)}:${pad(baseline.cron_schedule?.minute_utc ?? 0)}`} mono />
          <Stat label="Budget / pass" value={`$${baseline.daily_budget_usd ?? '—'}`} mono />
          <Stat label="Research depth" value={baseline.research_depth || 'standard'} />
          <Stat label="Dispatcher" value={baseline.research_dispatcher || 'stub'} />
          <Stat label="Auto-watch" value={baseline.auto_watch_enabled === false ? 'off' : 'on'} />
        </div>
      </div>

      {/* ═══ Tab 2: 6 priority areas ═══ */}
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3 className="panel-title">🎯 Tab 2 — Custom Direction (6 weighted priority areas)</h3>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>edited monthly · {areaEntries.length}/6 configured</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
          {sortedAreas.map((area: any) => {
            const pct = Math.round(((area.weight || 0) / totalWeight) * 100);
            const findingsHere = findingsByArea[area.id] || 0;
            return (
              <div
                key={area.id}
                style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: '1.1rem', marginRight: 8 }}>{AREA_ICON[area.id as PriorityAreaId] || '◆'}</span>
                    <strong style={{ color: '#e2e8f0', textTransform: 'capitalize' }}>{String(area.id).replace(/_/g, ' ')}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ color: '#a855f7', fontWeight: 700, fontSize: '0.95rem' }}>weight {area.weight}</span>
                    <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{pct}%</span>
                  </div>
                </div>
                {/* Weight bar */}
                <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #a855f7, #ec4899)' }} />
                </div>
                {area.current_state && (
                  <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5, marginBottom: 6 }}>
                    <strong style={{ color: '#cbd5e1' }}>Now:</strong> {String(area.current_state).slice(0, 150)}{String(area.current_state).length > 150 ? '…' : ''}
                  </p>
                )}
                {area.target_3mo && (
                  <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5 }}>
                    <strong style={{ color: '#34d399' }}>3mo:</strong> {String(area.target_3mo).slice(0, 130)}{String(area.target_3mo).length > 130 ? '…' : ''}
                  </p>
                )}
                <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: '0.7rem', color: '#64748b' }}>
                  <span>📍 {findingsHere} finding{findingsHere === 1 ? '' : 's'}</span>
                  <span>🚫 {(area.anti_goals || []).length} anti-goal{(area.anti_goals || []).length === 1 ? '' : 's'}</span>
                  <span>🔬 {(area.research_directions || []).length} direction{(area.research_directions || []).length === 1 ? '' : 's'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ═══ Findings-by-area chart ═══ */}
      {totalFindings > 0 && (
        <div className="glass-panel" style={{ marginBottom: 20 }}>
          <div className="panel-header"><h3 className="panel-title">📈 Findings by priority area ({totalFindings} total)</h3></div>
          <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {PRIORITY_AREAS.map(area => {
              const n = findingsByArea[area] || 0;
              const pct = (n / maxAreaFindings) * 100;
              return (
                <div key={area} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 40px', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: '#cbd5e1', fontSize: '0.8rem' }}>{AREA_ICON[area]} {area.replace(/_/g, ' ')}</span>
                  <div style={{ height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: n > 0 ? 'linear-gradient(90deg, #3b82f6, #06b6d4)' : 'transparent', transition: 'width 0.3s ease' }} />
                  </div>
                  <span style={{ color: n > 0 ? '#06b6d4' : '#475569', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem', textAlign: 'right' }}>{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ Two columns: passes + proposals ═══ */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, marginBottom: 20 }}>
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">🛰 Recent passes</h3>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{state?.passes?.length || 0} of {summary.pass_count || 0}</span>
          </div>
          <div className="panel-body">
            {(!state?.passes || state.passes.length === 0) && (
              <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                No passes yet. Click "Run a pass now" above to launch one.
              </p>
            )}
            {(state?.passes || []).map(p => (
              <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '10px 0', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                <div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <strong style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.85rem' }}>{p.id}</strong>
                    <span style={{ ...passStatusStyle(p.status), fontSize: '0.7rem', padding: '2px 8px', borderRadius: 100 }}>{p.status}</span>
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{p.pass_kind}</span>
                  </div>
                  <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: 2 }}>
                    {p.completed_at ? new Date(p.completed_at).toLocaleString() : 'in flight'}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: '0.75rem', color: '#cbd5e1' }}>
                  <div>📍 {p.findings_count ?? 0}</div>
                  <div>📨 {p.proposals_emitted ?? 0}</div>
                  <div style={{ color: '#34d399' }}>${(p.cost_usd ?? 0).toFixed(2)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📨 Architect proposals</h3>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{(state?.proposals || []).length} surfaced</span>
          </div>
          <div className="panel-body">
            {(!state?.proposals || state.proposals.length === 0) && (
              <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                No proposals yet. The architect emits these from research findings.
              </p>
            )}
            {(state?.proposals || []).slice(0, 12).map(p => {
              const kind = KIND_BADGE[p.kind] || { color: '#64748b', label: p.kind };
              const stt = STATE_BADGE[p.state] || { color: '#64748b', label: p.state };
              const area = p.rationale?.meta?.priority_area;
              const canDecide = ['ready', 'evaluating', 'draft'].includes(p.state);
              return (
                <div key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                    <span style={{ background: kind.color, color: '#fff', padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>{kind.label}</span>
                    <span style={{ background: stt.color, color: '#fff', padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>{stt.label}</span>
                    {area && <span style={{ color: '#a855f7', fontSize: '0.7rem' }}>{AREA_ICON[area as PriorityAreaId] || ''} {area}</span>}
                    <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: '0.65rem', marginLeft: 'auto' }}>{p.id}</span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5, marginBottom: 6 }}>
                    {p.rationale?.summary || p.change?.target || '(no summary)'}
                  </div>
                  {canDecide && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <button
                        onClick={() => decideProposal(p.id, 'approve')}
                        disabled={!!busy}
                        style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', color: '#34d399', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => decideProposal(p.id, 'reject')}
                        disabled={!!busy}
                        style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══ Strategic watch ═══ */}
      {Array.isArray(cd?.strategic_watch) && cd.strategic_watch.length > 0 && (
        <div className="glass-panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h3 className="panel-title">📡 Strategic watch ({cd.strategic_watch.length})</h3>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>orgs / products the architect tracks</span>
          </div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {cd.strategic_watch.map((w: any) => (
              <div key={w.id} style={{ background: 'rgba(0,0,0,0.3)', borderRadius: 8, padding: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                  <strong style={{ color: '#e2e8f0', fontSize: '0.85rem' }}>{w.name}</strong>
                  <span style={{ ...importanceStyle(w.importance), fontSize: '0.6rem', padding: '1px 6px', borderRadius: 4 }}>{w.importance || 'medium'}</span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: 4 }}>
                  {w.kind || 'org'} · {w.watch_frequency || 'weekly'}
                </div>
                {w.notes && <div style={{ color: '#94a3b8', fontSize: '0.7rem', lineHeight: 1.5 }}>{w.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer info */}
      <div style={{ color: '#475569', fontSize: '0.7rem', textAlign: 'center', padding: 16 }}>
        KB at <code style={inlineCode}>{state?.kb_root}</code> · Phase 21-A · stub dispatcher (= $0) · 21-B will replace with Sonnet researcher (~$1-2/day)
      </div>
    </div>
  );
};

const PageHeader: React.FC<{ runPass: () => void; busy: string | null; disabled?: boolean }> = ({ runPass, busy, disabled }) => (
  <div className="page-header">
    <div>
      <h1 className="page-title">Master Architect</h1>
      <p className="page-subtitle">Continuous research · Standing Orders · Founder Proposal Portal (Phase 21-A)</p>
    </div>
    <button
      onClick={runPass}
      disabled={disabled || busy === 'run_pass'}
      style={{
        padding: '10px 18px',
        background: disabled ? 'rgba(100,116,139,0.2)' : 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
        border: 'none',
        borderRadius: 8,
        color: disabled ? '#64748b' : '#fff',
        fontWeight: 700,
        cursor: disabled || busy === 'run_pass' ? 'not-allowed' : 'pointer',
        fontSize: '0.85rem',
        opacity: busy === 'run_pass' ? 0.5 : 1,
      }}
    >
      {busy === 'run_pass' ? '⏳ Running pass…' : '▶ Run a pass now (stub · $0)'}
    </button>
  </div>
);

const FlashBar: React.FC<{ msg: string; kind: 'success' | 'error'; onDismiss?: () => void }> = ({ msg, kind, onDismiss }) => {
  const colors = kind === 'success'
    ? { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', fg: '#34d399' }
    : { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.4)', fg: '#f87171' };
  return (
    <div style={{ marginBottom: 16, padding: 12, background: colors.bg, border: `1px solid ${colors.border}`, borderRadius: 8, color: colors.fg, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span>{msg}</span>
      {onDismiss && <button onClick={onDismiss} style={{ background: 'transparent', border: 'none', color: colors.fg, cursor: 'pointer', fontSize: '1rem' }}>×</button>}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: any; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '8px 10px' }}>
    <div style={{ color: '#64748b', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
    <div style={{ color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 600, fontFamily: mono ? 'monospace' : 'inherit', textTransform: mono ? 'none' : 'capitalize' }}>{String(value)}</div>
  </div>
);

const inlineCode: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: '0.85em',
  color: '#fbbf24',
  fontFamily: 'monospace',
};

function pad(n: number) { return String(n).padStart(2, '0'); }

function passStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    succeeded: { bg: 'rgba(16,185,129,0.15)', fg: '#34d399' },
    failed:    { bg: 'rgba(239,68,68,0.15)',  fg: '#f87171' },
    partial:   { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24' },
    running:   { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa' },
  };
  const c = map[status] || { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' };
  return { background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase' };
}

function importanceStyle(importance: string): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    high:   { bg: 'rgba(239,68,68,0.15)',  fg: '#f87171' },
    medium: { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24' },
    low:    { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' },
  };
  const c = map[importance] || map.medium;
  return { background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase' };
}

export default MasterArchitect;
