import React, { useEffect, useState } from 'react';

/**
 * Phase 21-A surface — Master Architect / Standing Orders / Founder Proposal Portal.
 *
 * Two modes:
 *   VIEW (default) — read-only render of Standing Orders + KB + passes + proposals
 *                    + Run-a-pass button + per-proposal approve/reject
 *   EDIT           — form fields for Tab 1 baseline + Tab 2 (stance + 6 priority
 *                    areas + horizon). Save bumps version; the architect's
 *                    version-watermark detector picks it up on the next pass.
 *
 * Empty state distinguishes between:
 *   - API unreachable                 (red "backend not reachable")
 *   - API works but no SO configured  (purple seed button + "start from blank")
 *
 * Backend: /api/architect/{state,seed,standing_orders,run_pass,proposal/:id/:action}.
 * Stub dispatcher = $0; safe to invoke from the UI.
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
const AREA_DESCRIPTION: Record<PriorityAreaId, string> = {
  models: 'LLM tier strategy, cost/quality posture, fine-tuning ambitions',
  agents: 'Named pipeline agents (Picard, Sisko, Troi, …) + new candidates',
  languages: 'Code/output stacks the factory produces',
  tools: 'MCP plane, external integrations, IDE tooling',
  output_quality: 'Tuvok test rigor, Data review depth, Verify cycle',
  operations: 'Cost / speed / throughput / deployment surface',
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

const STANCE_OPTIONS = {
  risk_appetite:    ['risk-averse', 'balanced', 'experimental'],
  quality_vs_speed: ['quality-first', 'balanced', 'speed-first'],
  cost_sensitivity: ['high', 'medium', 'low'],
  change_tolerance: ['stable-lock', 'gradual', 'aggressive'],
};
const RESEARCH_DEPTHS = ['light', 'standard', 'deep'];
const DISPATCHERS = ['stub', 'sonnet', 'opus'];

interface ArchitectState {
  standing_orders: any | null;
  summary: any;
  passes: any[];
  findings: any[];
  proposals: any[];
  kb_root: string;
  has_seed: boolean;
}

// Builder for a fresh, schema-valid Standing Orders skeleton (every required
// shape filled in with sensible defaults). Used for "start from blank".
function freshStandingOrders(): any {
  const today = new Date().toISOString().slice(0, 10);
  const inThreeMonths = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
  return {
    version: 1,
    baseline: {
      cron_schedule: { hour_utc: 0, minute_utc: 0 },
      daily_budget_usd: 1.5,
      research_depth: 'standard',
      research_dispatcher: 'stub',
      auto_watch_enabled: true,
      auto_watch_disabled_ids: [],
    },
    custom_direction: {
      effective_period: { start_date: today, end_date: inThreeMonths, horizon_label: '' },
      overall_stance: { risk_appetite: 'balanced', quality_vs_speed: 'balanced', cost_sensitivity: 'medium', change_tolerance: 'gradual' },
      priority_areas: PRIORITY_AREAS.map(id => ({
        id, weight: 3, current_state: '', target_3mo: '', target_6mo: '',
        hard_constraints: [], anti_goals: [], research_directions: [], notes: '',
      })),
      strategic_watch: [],
      notes: '',
    },
  };
}

const MasterArchitect: React.FC = () => {
  const [state, setState] = useState<ArchitectState | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiUnreachable, setApiUnreachable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  // Edit-mode state — when non-null, the page shows forms for these values.
  // Saving POSTs them; cancel discards.
  const [draft, setDraft] = useState<any | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/telemetry/architect/state');
      if (!res.ok) throw new Error(`/api/architect/state returned ${res.status}`);
      const data = await res.json();
      setState(data);
      setApiUnreachable(false);
      setError(null);
    } catch (e: any) {
      // The architect routes don't exist on this server (most likely) or the
      // telemetry process is down. Surface a precise message — don't mislead
      // the user into thinking it's a config problem.
      setApiUnreachable(true);
      setError(e?.message || 'failed to reach /api/architect/state');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const flash = (msg: string) => {
    setFlashMsg(msg);
    setTimeout(() => setFlashMsg(null), 5000);
  };

  const seed = async () => {
    setBusy('seed');
    try {
      const res = await fetch('/telemetry/architect/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `seed failed: ${res.status}`);
      flash(`✅ Standing Orders seeded from realistic v1 example (post-Phase 2.76 / 21-A close).`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'seed failed'); }
    finally { setBusy(null); }
  };

  const enterEdit = () => {
    setDraft(JSON.parse(JSON.stringify(state?.standing_orders || freshStandingOrders())));
  };

  const startFromBlank = () => {
    setState(s => s ? { ...s } : { standing_orders: null, summary: {}, passes: [], findings: [], proposals: [], kb_root: '', has_seed: false });
    setDraft(freshStandingOrders());
  };

  const cancelEdit = () => setDraft(null);

  const saveDraft = async () => {
    if (!draft) return;
    setBusy('save');
    try {
      const res = await fetch('/telemetry/architect/standing_orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ standing_orders: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `save failed: ${res.status}`);
      flash(`✅ Standing Orders saved as v${data.version}. Architect will re-balance attention on next pass.`);
      setDraft(null);
      await refresh();
    } catch (e: any) { setError(e?.message || 'save failed'); }
    finally { setBusy(null); }
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
      flash(`✅ Pass ${data.pass?.id || ''} done — ${data.findings_count ?? 0} findings, ${data.proposals_count ?? 0} proposals (stub · $0).`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'run pass failed'); }
    finally { setBusy(null); }
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
    } catch (e: any) { setError(e?.message || `${action} failed`); }
    finally { setBusy(null); }
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

  // ─── API unreachable state ─────────────────────────────────────────
  if (apiUnreachable) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Master Architect</h1>
            <p className="page-subtitle">Continuous research · Standing Orders · Founder Proposal Portal (Phase 21-A)</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: 32 }}>
          <h2 style={{ color: '#ef4444', marginBottom: 12 }}>⚠ Architect API not reachable</h2>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 12 }}>
            The Phase 21-A backend endpoints under <code style={inlineCode}>/api/architect/*</code> didn't respond.
            Most likely the telemetry server hasn't been restarted since this code shipped — it's still running the pre-Phase-21 build.
          </p>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16 }}>
            Fix: restart the systemd unit that runs <code style={inlineCode}>factory-dashboard/server/telemetry.mjs</code>, then reload this page.
          </p>
          {error && <p style={{ color: '#94a3b8', fontSize: '0.8rem' }}>Underlying error: <code style={inlineCode}>{error}</code></p>}
          <button onClick={refresh} style={{ marginTop: 16, padding: '8px 16px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#cbd5e1', cursor: 'pointer' }}>↻ Retry</button>
        </div>
      </div>
    );
  }

  const editing = draft !== null;
  const so = editing ? draft : state?.standing_orders;
  const cd = so?.custom_direction || {};
  const baseline = so?.baseline || {};
  const summary = state?.summary || {};
  const findingsByArea = summary.findings_by_area || {};
  const totalFindings = summary.finding_count || 0;
  const maxAreaFindings = Math.max(1, ...Object.values(findingsByArea).map((n: any) => Number(n) || 0));

  // ─── Empty state: API works, no Standing Orders yet ─────────────────
  if (!state?.standing_orders && !editing) {
    return (
      <div className="fade-in">
        <PageHeader runPass={runPass} busy={busy} disabled enterEdit={() => {}} editVisible={false} />
        {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
        {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

        <div className="glass-panel" style={{ padding: 32 }}>
          <h2 style={{ color: '#fbbf24', marginBottom: 12 }}>👑 Standing Orders not configured yet</h2>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16 }}>
            <strong style={{ color: '#e2e8f0' }}>Standing Orders</strong> is the founder's permanent directive to the Master Architect — what the architect researches autonomously
            (Tab 1 <code style={inlineCode}>baseline</code>) and how the founder steers it (Tab 2 <code style={inlineCode}>custom_direction</code>: 6 weighted priority areas, ~60 fillable slots).
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={startFromBlank}
              style={{
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
                border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem',
              }}
            >
              ✎ Configure from blank
            </button>
            <button
              onClick={seed}
              disabled={busy === 'seed' || !state?.has_seed}
              style={{
                padding: '12px 20px',
                background: state?.has_seed ? 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)' : 'rgba(100,116,139,0.2)',
                border: 'none', borderRadius: 8,
                color: state?.has_seed ? '#fff' : '#64748b',
                fontWeight: 700,
                cursor: busy === 'seed' || !state?.has_seed ? 'not-allowed' : 'pointer',
                fontSize: '0.95rem',
                opacity: busy === 'seed' ? 0.5 : 1,
              }}
            >
              {busy === 'seed' ? 'Seeding…' : '👑 Seed from realistic v1 example'}
            </button>
          </div>
          {!state?.has_seed && (
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 12 }}>
              The example file isn't on the server. "Configure from blank" still works.
            </p>
          )}
          <p style={{ color: '#64748b', fontSize: '0.75rem', marginTop: 16 }}>
            KB root: <code style={inlineCode}>{state?.kb_root || '(unknown)'}</code>
          </p>
        </div>
      </div>
    );
  }

  const areaEntries: any[] = Array.isArray(cd?.priority_areas) ? cd.priority_areas : [];
  const totalWeight = areaEntries.reduce((acc, a) => acc + (Number(a.weight) || 0), 0) || 1;

  // Helpers for editing nested draft fields (immutable)
  const setBaselineField = (key: string, val: any) =>
    setDraft((d: any) => ({ ...d, baseline: { ...(d.baseline || {}), [key]: val } }));
  const setCronField = (key: 'hour_utc' | 'minute_utc', val: number) =>
    setDraft((d: any) => ({ ...d, baseline: { ...(d.baseline || {}), cron_schedule: { ...(d.baseline?.cron_schedule || {}), [key]: val } } }));
  const setStanceField = (key: string, val: string) =>
    setDraft((d: any) => ({ ...d, custom_direction: { ...(d.custom_direction || {}), overall_stance: { ...(d.custom_direction?.overall_stance || {}), [key]: val } } }));
  const setEffectiveField = (key: string, val: string) =>
    setDraft((d: any) => ({ ...d, custom_direction: { ...(d.custom_direction || {}), effective_period: { ...(d.custom_direction?.effective_period || {}), [key]: val } } }));
  const setAreaField = (areaId: string, key: string, val: any) =>
    setDraft((d: any) => ({
      ...d,
      custom_direction: {
        ...(d.custom_direction || {}),
        priority_areas: (d.custom_direction?.priority_areas || []).map((a: any) =>
          a.id === areaId ? { ...a, [key]: val } : a
        ),
      },
    }));

  return (
    <div className="fade-in">
      <PageHeader
        runPass={runPass}
        busy={busy}
        editVisible={!editing}
        enterEdit={enterEdit}
        editing={editing}
        save={saveDraft}
        cancel={cancelEdit}
      />
      {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
      {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

      {/* Card row 1: header + KB summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📜 Standing Orders v{so.version}</h3>
            {!editing
              ? <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{cd?.effective_period?.horizon_label || '—'}</span>
              : <span style={{ color: '#fbbf24', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>● Editing</span>
            }
          </div>
          <div className="panel-body">
            {/* Effective period (editable) */}
            {editing && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8, marginBottom: 12 }}>
                <Field label="Start date">
                  <input type="date" value={cd.effective_period?.start_date || ''} onChange={e => setEffectiveField('start_date', e.target.value)} style={inputStyle} />
                </Field>
                <Field label="End date">
                  <input type="date" value={cd.effective_period?.end_date || ''} onChange={e => setEffectiveField('end_date', e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Horizon label">
                  <input type="text" placeholder="e.g. Q3 2026 — internal testing band (v0.0.1 → v1)" value={cd.effective_period?.horizon_label || ''} onChange={e => setEffectiveField('horizon_label', e.target.value)} style={inputStyle} />
                </Field>
              </div>
            )}

            {/* Overall stance — 4 dropdowns or 4 readonly stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {(['risk_appetite', 'quality_vs_speed', 'cost_sensitivity', 'change_tolerance'] as const).map(k => (
                editing
                  ? <Field key={k} label={prettyLabel(k)}>
                      <select value={cd.overall_stance?.[k] || ''} onChange={e => setStanceField(k, e.target.value)} style={inputStyle}>
                        <option value="">—</option>
                        {STANCE_OPTIONS[k].map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </Field>
                  : <Stat key={k} label={prettyLabel(k)} value={cd?.overall_stance?.[k] || '—'} />
              ))}
            </div>
            {!editing && cd?.notes && (
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

      {/* Tab 1 — baseline */}
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3 className="panel-title">⚙️ Tab 1 — Baseline (autonomous behavior)</h3>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>edited rarely · quarterly</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          {editing ? <>
            <Field label="Cron hour (UTC)">
              <input type="number" min={0} max={23} value={baseline.cron_schedule?.hour_utc ?? 0} onChange={e => setCronField('hour_utc', Math.max(0, Math.min(23, Number(e.target.value))))} style={inputStyle} />
            </Field>
            <Field label="Cron minute (UTC)">
              <input type="number" min={0} max={59} value={baseline.cron_schedule?.minute_utc ?? 0} onChange={e => setCronField('minute_utc', Math.max(0, Math.min(59, Number(e.target.value))))} style={inputStyle} />
            </Field>
            <Field label="Budget / pass (USD)">
              <input type="number" step={0.1} min={0} value={baseline.daily_budget_usd ?? 1.5} onChange={e => setBaselineField('daily_budget_usd', Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="Research depth">
              <select value={baseline.research_depth || 'standard'} onChange={e => setBaselineField('research_depth', e.target.value)} style={inputStyle}>
                {RESEARCH_DEPTHS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
            <Field label="Dispatcher">
              <select value={baseline.research_dispatcher || 'stub'} onChange={e => setBaselineField('research_dispatcher', e.target.value)} style={inputStyle}>
                {DISPATCHERS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </> : <>
            <Stat label="Daily cron (UTC)" value={`${pad(baseline.cron_schedule?.hour_utc ?? 0)}:${pad(baseline.cron_schedule?.minute_utc ?? 0)}`} mono />
            <Stat label="Budget / pass" value={`$${baseline.daily_budget_usd ?? '—'}`} mono />
            <Stat label="Research depth" value={baseline.research_depth || 'standard'} />
            <Stat label="Dispatcher" value={baseline.research_dispatcher || 'stub'} />
            <Stat label="Auto-watch" value={baseline.auto_watch_enabled === false ? 'off' : 'on'} />
          </>}
        </div>
      </div>

      {/* Tab 2 — 6 priority areas (the "what to focus on" config) */}
      <div className="glass-panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h3 className="panel-title">🎯 Tab 2 — Custom Direction (6 weighted priority areas)</h3>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>edited monthly · {areaEntries.length}/6 configured</span>
        </div>
        <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: editing ? '1fr' : 'repeat(2, 1fr)', gap: 14 }}>
          {areaEntries.map((area: any) => {
            const pct = Math.round(((area.weight || 0) / totalWeight) * 100);
            const findingsHere = findingsByArea[area.id] || 0;
            return (
              <div key={area.id} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: '1.1rem', marginRight: 8 }}>{AREA_ICON[area.id as PriorityAreaId] || '◆'}</span>
                    <strong style={{ color: '#e2e8f0', textTransform: 'capitalize' }}>{String(area.id).replace(/_/g, ' ')}</strong>
                    {!editing && <span style={{ color: '#64748b', fontSize: '0.7rem', marginLeft: 8 }}>· {AREA_DESCRIPTION[area.id as PriorityAreaId] || ''}</span>}
                  </div>
                  {!editing && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ color: '#a855f7', fontWeight: 700, fontSize: '0.95rem' }}>weight {area.weight}</span>
                      <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{pct}%</span>
                    </div>
                  )}
                </div>

                {editing && (
                  <>
                    <p style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: 10 }}>{AREA_DESCRIPTION[area.id as PriorityAreaId]}</p>
                    {/* Weight slider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <label style={{ color: '#94a3b8', fontSize: '0.75rem', minWidth: 80 }}>Weight (1-5)</label>
                      <input
                        type="range" min={1} max={5} step={1}
                        value={area.weight ?? 3}
                        onChange={e => setAreaField(area.id, 'weight', Number(e.target.value))}
                        style={{ flexGrow: 1 }}
                      />
                      <span style={{ color: '#a855f7', fontWeight: 700, fontFamily: 'monospace', minWidth: 24 }}>{area.weight ?? 3}</span>
                      <span style={{ color: '#64748b', fontSize: '0.7rem', minWidth: 36 }}>{pct}%</span>
                    </div>
                    <Field label="Current state">
                      <textarea value={area.current_state || ''} onChange={e => setAreaField(area.id, 'current_state', e.target.value)} placeholder="One line where-we-are." rows={2} style={textareaStyle} />
                    </Field>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                      <Field label="Target — 3 months">
                        <textarea value={area.target_3mo || ''} onChange={e => setAreaField(area.id, 'target_3mo', e.target.value)} placeholder="1-3 sentences" rows={3} style={textareaStyle} />
                      </Field>
                      <Field label="Target — 6 months">
                        <textarea value={area.target_6mo || ''} onChange={e => setAreaField(area.id, 'target_6mo', e.target.value)} placeholder="1-3 sentences" rows={3} style={textareaStyle} />
                      </Field>
                    </div>
                    <Field label="Notes (architect-visible)">
                      <textarea value={area.notes || ''} onChange={e => setAreaField(area.id, 'notes', e.target.value)} placeholder="Optional free-form context" rows={2} style={textareaStyle} />
                    </Field>
                    {/* Read-only summary of array fields the editor doesn't expose */}
                    <div style={{ marginTop: 10, fontSize: '0.7rem', color: '#64748b' }}>
                      🚫 {(area.anti_goals || []).length} anti-goals · 🛡 {(area.hard_constraints || []).length} constraints · 🔬 {(area.research_directions || []).length} directions
                      <span style={{ marginLeft: 6, fontStyle: 'italic' }}>(edit by hand in <code style={inlineCode}>_kb/standing_orders.json</code> for now)</span>
                    </div>
                  </>
                )}

                {!editing && (
                  <>
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
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Findings-by-area chart */}
      {!editing && totalFindings > 0 && (
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

      {/* Two columns: passes + proposals (view mode only) */}
      {!editing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 20, marginBottom: 20 }}>
          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">🛰 Recent passes</h3>
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{state?.passes?.length || 0} of {summary.pass_count || 0}</span>
            </div>
            <div className="panel-body">
              {(!state?.passes || state.passes.length === 0) && (
                <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                  No passes yet. Click "Run a pass now" above.
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
                        <button onClick={() => decideProposal(p.id, 'approve')} disabled={!!busy} style={{ padding: '4px 10px', background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', color: '#34d399', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>✓ Approve</button>
                        <button onClick={() => decideProposal(p.id, 'reject')} disabled={!!busy} style={{ padding: '4px 10px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', color: '#f87171', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer' }}>✕ Reject</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Strategic watch (view mode only) */}
      {!editing && Array.isArray(cd?.strategic_watch) && cd.strategic_watch.length > 0 && (
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
                <div style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: 4 }}>{w.kind || 'org'} · {w.watch_frequency || 'weekly'}</div>
                {w.notes && <div style={{ color: '#94a3b8', fontSize: '0.7rem', lineHeight: 1.5 }}>{w.notes}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ color: '#475569', fontSize: '0.7rem', textAlign: 'center', padding: 16 }}>
        KB at <code style={inlineCode}>{state?.kb_root}</code> · Phase 21-A · stub dispatcher (= $0) · 21-B will replace with Sonnet researcher (~$1-2/day)
      </div>
    </div>
  );
};

interface PageHeaderProps {
  runPass: () => void;
  busy: string | null;
  disabled?: boolean;
  editVisible: boolean;
  enterEdit: () => void;
  editing?: boolean;
  save?: () => void;
  cancel?: () => void;
}
const PageHeader: React.FC<PageHeaderProps> = ({ runPass, busy, disabled, editVisible, enterEdit, editing, save, cancel }) => (
  <div className="page-header">
    <div>
      <h1 className="page-title">Master Architect</h1>
      <p className="page-subtitle">Continuous research · Standing Orders · Founder Proposal Portal (Phase 21-A)</p>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      {editing && save && cancel && <>
        <button onClick={cancel} disabled={busy === 'save'} style={{ padding: '10px 18px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#cbd5e1', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>Cancel</button>
        <button onClick={save} disabled={busy === 'save'} style={{ padding: '10px 22px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: busy === 'save' ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: busy === 'save' ? 0.5 : 1 }}>{busy === 'save' ? '💾 Saving…' : '💾 Save Standing Orders'}</button>
      </>}
      {editVisible && (
        <button onClick={enterEdit} style={{ padding: '10px 18px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.5)', borderRadius: 8, color: '#c4b5fd', fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem' }}>✎ Edit Standing Orders</button>
      )}
      {!editing && (
        <button
          onClick={runPass}
          disabled={disabled || busy === 'run_pass'}
          style={{
            padding: '10px 18px',
            background: disabled ? 'rgba(100,116,139,0.2)' : 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)',
            border: 'none', borderRadius: 8,
            color: disabled ? '#64748b' : '#fff',
            fontWeight: 700, cursor: disabled || busy === 'run_pass' ? 'not-allowed' : 'pointer', fontSize: '0.85rem',
            opacity: busy === 'run_pass' ? 0.5 : 1,
          }}
        >
          {busy === 'run_pass' ? '⏳ Running pass…' : '▶ Run a pass now (stub · $0)'}
        </button>
      )}
    </div>
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

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <span style={{ color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
    {children}
  </label>
);

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: '8px 10px',
  color: '#e2e8f0',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: 'vertical',
  minHeight: 50,
  lineHeight: 1.5,
};

const inlineCode: React.CSSProperties = {
  background: 'rgba(0,0,0,0.4)',
  padding: '2px 6px',
  borderRadius: 4,
  fontSize: '0.85em',
  color: '#fbbf24',
  fontFamily: 'monospace',
};

function pad(n: number) { return String(n).padStart(2, '0'); }
function prettyLabel(k: string) { return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

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
