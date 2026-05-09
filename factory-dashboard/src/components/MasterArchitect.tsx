import React, { useEffect, useState } from 'react';
import BriefForm from './architect/BriefForm';
import PresetSelect from './architect/PresetSelect';

/**
 * Master Architect page — Phase 21-A + 21-A.1.
 *
 * Three tabs:
 *   1. Standing Orders & Roadmap — Standing Orders editor (baseline + Tab 2 priority areas) +
 *      Platform Evolution Roadmap cadence editor (daily/weekly/monthly toggles)
 *   2. R&D Brief                  — founder-driven structured-prompt form + history
 *   3. Reports & Proposals        — cycle reports + brief reports + architect proposals
 *
 * Backend: /api/architect/{state, seed, standing_orders POST, run_pass, brief, briefs, reports,
 *                          reports/:id, reports/:id/read, cadence/:kind/run,
 *                          pause, resume, proposal/:id/:action}
 */

const PRIORITY_AREAS = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'] as const;
type PriorityAreaId = typeof PRIORITY_AREAS[number];

const AREA_ICON: Record<PriorityAreaId, string> = {
  models: '🧠', agents: '🖖', languages: '🔤', tools: '🔧', output_quality: '✨', operations: '⚙️',
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

const DEPTH_PRESETS = [
  { value: 'light', label: 'Light watch' },
  { value: 'standard', label: 'Standard synthesis' },
  { value: 'deep', label: 'Deep strategic' },
];
const DISPATCHER_PRESETS = [
  { value: 'stub', label: 'Stub ($0)', hint: 'synthetic findings — Phase 21-A only' },
  { value: 'sonnet', label: 'Sonnet (~$0.30/pass)', hint: 'real research — needs 21-B' },
  { value: 'opus', label: 'Opus (~$1.50/pass)', hint: 'deep research — needs 21-B' },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_DAY_RULES = [
  { value: 'last-thursday', label: 'Last Thursday of month' },
  { value: 'last-day', label: 'Last day of month' },
  { value: 'first-day', label: 'First day of month' },
];

interface ArchitectState {
  standing_orders: any | null;
  summary: any;
  passes: any[];
  findings: any[];
  proposals: any[];
  briefs: any[];
  reports: any[];
  unread_report_count: number;
  paused: boolean;
  kb_root: string;
  has_seed: boolean;
}

type TabKey = 'roadmap' | 'brief' | 'reports';

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
      timezone: 'Asia/Kolkata',
      paused: false,
      cadences: {
        daily:   { enabled: false, time_local: '22:00', report_enabled: false, budget_usd: 0.5, depth: 'light',    dispatcher: 'stub' },
        weekly:  { enabled: false, day_of_week: 4, time_local: '22:00', report_enabled: true, budget_usd: 2.0, depth: 'standard', dispatcher: 'stub' },
        monthly: { enabled: true,  day_rule: 'last-thursday', time_local: '22:00', report_enabled: true, budget_usd: 8.0, depth: 'deep',     dispatcher: 'stub' },
      },
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
  const [draft, setDraft] = useState<any | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('roadmap');
  const [openReport, setOpenReport] = useState<any | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch('/telemetry/architect/state');
      if (!res.ok) throw new Error(`/api/architect/state returned ${res.status}`);
      const data = await res.json();
      setState(data);
      setApiUnreachable(false);
      setError(null);
    } catch (e: any) {
      setApiUnreachable(true);
      setError(e?.message || 'failed to reach /api/architect/state');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);
  // Lightweight poll — picks up daemon-fired reports without manual reload
  useEffect(() => {
    if (apiUnreachable || loading) return;
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [apiUnreachable, loading]);

  const flash = (msg: string) => { setFlashMsg(msg); setTimeout(() => setFlashMsg(null), 5000); };

  const seed = async () => {
    setBusy('seed');
    try {
      const res = await fetch('/telemetry/architect/seed', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `seed failed: ${res.status}`);
      flash(`✅ Standing Orders seeded from realistic v1 example.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'seed failed'); }
    finally { setBusy(null); }
  };

  const enterEdit = () => setDraft(JSON.parse(JSON.stringify(state?.standing_orders || freshStandingOrders())));
  const startFromBlank = () => setDraft(freshStandingOrders());
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
      flash(`✅ Standing Orders saved as v${data.version}.`);
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
      flash(`✅ Pass ${data.pass?.id || ''} done — ${data.findings_count ?? 0} findings, ${data.proposals_count ?? 0} proposals.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'run pass failed'); }
    finally { setBusy(null); }
  };

  const runCadenceNow = async (cadenceKind: 'daily' | 'weekly' | 'monthly') => {
    setBusy(`cadence-${cadenceKind}`);
    try {
      const res = await fetch(`/telemetry/architect/cadence/${cadenceKind}/run`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `cadence run failed: ${res.status}`);
      flash(`✅ ${cadenceKind} cycle done — pass ${data.pass?.id || ''}${data.report ? `, report ${data.report.id}` : ''}.`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'cadence run failed'); }
    finally { setBusy(null); }
  };

  const togglePause = async () => {
    setBusy('pause');
    try {
      const path = state?.paused ? 'resume' : 'pause';
      const res = await fetch(`/telemetry/architect/${path}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `${path} failed`);
      flash(`✅ Architect ${data.paused ? 'paused' : 'resumed'} (v${data.version}).`);
      await refresh();
    } catch (e: any) { setError(e?.message || 'pause/resume failed'); }
    finally { setBusy(null); }
  };

  const submitBrief = async (form: any) => {
    setBusy('brief');
    try {
      const res = await fetch('/telemetry/architect/brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `brief failed: ${res.status}`);
      flash(`✅ Brief ${data.brief?.id || ''} done — report ${data.report?.id || ''} ready.`);
      await refresh();
      if (data.report) setOpenReport(data.report);
    } catch (e: any) { setError(e?.message || 'brief failed'); }
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

  const openReportById = async (id: string) => {
    try {
      const res = await fetch(`/telemetry/architect/reports/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'failed to load report');
      // mark read
      await fetch(`/telemetry/architect/reports/${encodeURIComponent(id)}/read`, { method: 'POST' });
      setOpenReport(data);
      await refresh();
    } catch (e: any) { setError(e?.message || 'open report failed'); }
  };

  if (loading) {
    return (
      <div className="fade-in">
        <div className="page-header"><h1 className="page-title">Master Architect</h1></div>
        <div className="glass-panel" style={{ padding: 32, textAlign: 'center', color: '#94a3b8' }}>Loading architect state…</div>
      </div>
    );
  }

  if (apiUnreachable) {
    return (
      <div className="fade-in">
        <div className="page-header">
          <div>
            <h1 className="page-title">Master Architect</h1>
            <p className="page-subtitle">Continuous research · Standing Orders · Platform Evolution Roadmap</p>
          </div>
        </div>
        <div className="glass-panel" style={{ padding: 32 }}>
          <h2 style={{ color: '#ef4444', marginBottom: 12 }}>⚠ Architect API not reachable</h2>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 12 }}>
            The Phase 21-A backend endpoints under <code style={inlineCode}>/api/architect/*</code> didn't respond.
            Most likely the telemetry server hasn't been restarted since this code shipped.
          </p>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16 }}>
            Fix: <code style={inlineCode}>sudo systemctl restart factory-telemetry.service</code>, then reload this page.
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
  const cadences = baseline.cadences || {};
  const summary = state?.summary || {};
  const findingsByArea = summary.findings_by_area || {};
  const totalFindings = summary.finding_count || 0;
  const maxAreaFindings = Math.max(1, ...Object.values(findingsByArea).map((n: any) => Number(n) || 0));

  // ─── Empty state ─────────────────────────────────────────────────────
  if (!state?.standing_orders && !editing) {
    return (
      <div className="fade-in">
        <SimplePageHeader />
        {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
        {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

        <div className="glass-panel" style={{ padding: 32 }}>
          <h2 style={{ color: '#fbbf24', marginBottom: 12 }}>👑 Standing Orders not configured yet</h2>
          <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 16 }}>
            <strong style={{ color: '#e2e8f0' }}>Standing Orders</strong> is the founder's permanent directive — what the architect researches autonomously
            (Tab 1 <code style={inlineCode}>baseline</code>) and how the founder steers it (Tab 2 <code style={inlineCode}>custom_direction</code>: 6 weighted priority areas).
            The <strong>Platform Evolution Roadmap</strong> runs on top of Standing Orders — daily / weekly / monthly research cycles, fully founder-toggleable.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={startFromBlank} style={primaryBtn}>✎ Configure from blank</button>
            <button onClick={seed} disabled={busy === 'seed' || !state?.has_seed} style={{ ...secondaryBtn, opacity: state?.has_seed ? 1 : 0.5 }}>
              {busy === 'seed' ? 'Seeding…' : '👑 Seed from realistic v1 example'}
            </button>
          </div>
          {!state?.has_seed && <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 12 }}>The example file isn't on the server. "Configure from blank" still works.</p>}
        </div>
      </div>
    );
  }

  const areaEntries: any[] = Array.isArray(cd?.priority_areas) ? cd.priority_areas : [];
  const totalWeight = areaEntries.reduce((acc, a) => acc + (Number(a.weight) || 0), 0) || 1;

  // Draft mutators
  const setBaselineField = (key: string, val: any) => setDraft((d: any) => ({ ...d, baseline: { ...(d.baseline || {}), [key]: val } }));
  const setStanceField = (key: string, val: string) => setDraft((d: any) => ({ ...d, custom_direction: { ...(d.custom_direction || {}), overall_stance: { ...(d.custom_direction?.overall_stance || {}), [key]: val } } }));
  const setEffectiveField = (key: string, val: string) => setDraft((d: any) => ({ ...d, custom_direction: { ...(d.custom_direction || {}), effective_period: { ...(d.custom_direction?.effective_period || {}), [key]: val } } }));
  const setAreaField = (areaId: string, key: string, val: any) =>
    setDraft((d: any) => ({ ...d, custom_direction: { ...(d.custom_direction || {}), priority_areas: (d.custom_direction?.priority_areas || []).map((a: any) => a.id === areaId ? { ...a, [key]: val } : a) } }));
  const setCadenceField = (kind: string, key: string, val: any) =>
    setDraft((d: any) => ({ ...d, baseline: { ...(d.baseline || {}), cadences: { ...(d.baseline?.cadences || {}), [kind]: { ...(d.baseline?.cadences?.[kind] || {}), [key]: val } } } }));

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'roadmap', label: '📜 Standing Orders & Roadmap' },
    { key: 'brief',   label: '🔬 R&D Brief' },
    { key: 'reports', label: `📊 Reports & Proposals${state?.unread_report_count ? ` (${state.unread_report_count})` : ''}`, badge: state?.unread_report_count },
  ];

  return (
    <div className="fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Master Architect</h1>
          <p className="page-subtitle">Platform Evolution Roadmap · Founder R&D · Continuous Research (Phase 21-A)</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {state?.paused && <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', padding: '4px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>⏸ Paused</span>}
          <button onClick={togglePause} disabled={busy === 'pause'} style={{ padding: '8px 14px', background: state?.paused ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)', border: `1px solid ${state?.paused ? 'rgba(16,185,129,0.5)' : 'rgba(245,158,11,0.5)'}`, borderRadius: 8, color: state?.paused ? '#34d399' : '#fbbf24', fontWeight: 600, cursor: 'pointer', fontSize: '0.8rem' }}>
            {state?.paused ? '▶ Resume' : '⏸ Pause'}
          </button>
        </div>
      </div>

      {/* New-report banner */}
      {(state?.unread_report_count ?? 0) > 0 && activeTab !== 'reports' && (
        <div style={{ marginBottom: 16, padding: '10px 16px', background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.4)', borderRadius: 8, color: '#60a5fa', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>📨 <strong>{state?.unread_report_count ?? 0}</strong> new report{(state?.unread_report_count ?? 0) === 1 ? '' : 's'} ready for review</span>
          <button onClick={() => setActiveTab('reports')} style={{ background: 'transparent', border: '1px solid rgba(59,130,246,0.5)', color: '#60a5fa', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>Open Reports →</button>
        </div>
      )}

      {flashMsg && <FlashBar msg={flashMsg} kind="success" />}
      {error && <FlashBar msg={`⚠ ${error}`} kind="error" onDismiss={() => setError(null)} />}

      {/* Tab strip */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '10px 16px',
              background: activeTab === t.key ? 'rgba(168,85,247,0.15)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === t.key ? '2px solid #a855f7' : '2px solid transparent',
              color: activeTab === t.key ? '#e2e8f0' : '#94a3b8',
              fontWeight: activeTab === t.key ? 700 : 500,
              cursor: 'pointer',
              fontSize: '0.85rem',
              transition: 'all 0.15s ease',
            }}
          >{t.label}</button>
        ))}
      </div>

      {/* ═══ TAB 1: Standing Orders & Roadmap ═══ */}
      {activeTab === 'roadmap' && (
        <>
          {/* Standing Orders header card + KB summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20, marginBottom: 20 }}>
            <div className="glass-panel">
              <div className="panel-header">
                <h3 className="panel-title">📜 Standing Orders v{so.version}</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {!editing && <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>{cd?.effective_period?.horizon_label || '—'}</span>}
                  {editing && <span style={{ color: '#fbbf24', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>● Editing</span>}
                  {!editing && <button onClick={enterEdit} style={smallBtn}>✎ Edit</button>}
                  {!editing && <button onClick={runPass} disabled={busy === 'run_pass'} style={runBtn}>{busy === 'run_pass' ? '⏳' : '▶'} Run pass</button>}
                  {editing && <>
                    <button onClick={cancelEdit} style={smallBtn}>Cancel</button>
                    <button onClick={saveDraft} disabled={busy === 'save'} style={saveBtn}>{busy === 'save' ? '💾 Saving…' : '💾 Save'}</button>
                  </>}
                </div>
              </div>
              <div className="panel-body">
                {editing && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 8, marginBottom: 12 }}>
                    <Field label="Start date"><input type="date" value={cd.effective_period?.start_date || ''} onChange={e => setEffectiveField('start_date', e.target.value)} style={inputStyle} /></Field>
                    <Field label="End date"><input type="date" value={cd.effective_period?.end_date || ''} onChange={e => setEffectiveField('end_date', e.target.value)} style={inputStyle} /></Field>
                    <Field label="Horizon label"><input type="text" placeholder="e.g. Q3 2026 — internal testing band" value={cd.effective_period?.horizon_label || ''} onChange={e => setEffectiveField('horizon_label', e.target.value)} style={inputStyle} /></Field>
                  </div>
                )}
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
              </div>
            </div>
            <div className="glass-panel">
              <div className="panel-header"><h3 className="panel-title">🗂 KB Summary</h3></div>
              <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
                <Stat label="Targets" value={summary.target_count ?? 0} mono />
                <Stat label="Findings" value={totalFindings} mono />
                <Stat label="Passes" value={summary.pass_count ?? 0} mono />
                <Stat label="Briefs" value={state?.briefs?.length ?? 0} mono />
              </div>
            </div>
          </div>

          {/* Platform Evolution Roadmap — cadences */}
          <div className="glass-panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <h3 className="panel-title">🛰 Platform Evolution Roadmap — Schedules</h3>
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>tz: {baseline.timezone || 'Asia/Kolkata'}</span>
            </div>
            <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {(['daily', 'weekly', 'monthly'] as const).map(kind => {
                const c = cadences[kind] || {};
                return (
                  <div key={kind} style={{ background: c.enabled ? 'rgba(168,85,247,0.08)' : 'rgba(0,0,0,0.3)', border: `1px solid ${c.enabled ? 'rgba(168,85,247,0.3)' : 'rgba(255,255,255,0.06)'}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <strong style={{ color: '#e2e8f0', textTransform: 'capitalize', fontSize: '0.95rem' }}>{kind}</strong>
                      {editing ? (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input type="checkbox" checked={!!c.enabled} onChange={e => setCadenceField(kind, 'enabled', e.target.checked)} />
                          <span style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>enabled</span>
                        </label>
                      ) : (
                        <span style={{ color: c.enabled ? '#34d399' : '#64748b', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>{c.enabled ? '● ON' : 'off'}</span>
                      )}
                    </div>
                    {editing ? <>
                      {kind === 'weekly' && (
                        <Field label="Day of week"><select value={c.day_of_week ?? 4} onChange={e => setCadenceField(kind, 'day_of_week', Number(e.target.value))} style={inputStyle}>
                          {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
                        </select></Field>
                      )}
                      {kind === 'monthly' && (
                        <Field label="Day rule"><select value={c.day_rule || 'last-thursday'} onChange={e => setCadenceField(kind, 'day_rule', e.target.value)} style={inputStyle}>
                          {MONTH_DAY_RULES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select></Field>
                      )}
                      <Field label="Local time (HH:MM)"><input type="time" value={c.time_local || '22:00'} onChange={e => setCadenceField(kind, 'time_local', e.target.value)} style={inputStyle} /></Field>
                      <Field label="Budget (USD)"><input type="number" step={0.5} min={0} value={c.budget_usd ?? 1.5} onChange={e => setCadenceField(kind, 'budget_usd', Number(e.target.value))} style={inputStyle} /></Field>
                      <Field label="Research depth"><PresetSelect presets={DEPTH_PRESETS} value={c.depth || 'standard'} onChange={v => setCadenceField(kind, 'depth', v)} customPlaceholder="custom depth label" /></Field>
                      <Field label="Dispatcher"><PresetSelect presets={DISPATCHER_PRESETS} value={c.dispatcher || 'stub'} onChange={v => setCadenceField(kind, 'dispatcher', v)} customPlaceholder="custom dispatcher id" /></Field>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, cursor: 'pointer', fontSize: '0.8rem', color: '#cbd5e1' }}>
                        <input type="checkbox" checked={!!c.report_enabled} onChange={e => setCadenceField(kind, 'report_enabled', e.target.checked)} />
                        produce report
                      </label>
                    </> : <>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.78rem', color: '#cbd5e1' }}>
                        {kind === 'weekly' && <div><span style={{ color: '#64748b' }}>Day:</span> {DAYS[c.day_of_week ?? 4]}</div>}
                        {kind === 'monthly' && <div><span style={{ color: '#64748b' }}>When:</span> {(MONTH_DAY_RULES.find(r => r.value === c.day_rule)?.label) || c.day_rule || 'last Thu'}</div>}
                        <div><span style={{ color: '#64748b' }}>Time:</span> {c.time_local || '22:00'}</div>
                        <div><span style={{ color: '#64748b' }}>Budget:</span> ${c.budget_usd ?? '—'}</div>
                        <div><span style={{ color: '#64748b' }}>Depth:</span> {c.depth || 'standard'}</div>
                        <div><span style={{ color: '#64748b' }}>Dispatcher:</span> {c.dispatcher || 'stub'}</div>
                        <div><span style={{ color: '#64748b' }}>Report:</span> {c.report_enabled ? 'on' : 'off'}</div>
                      </div>
                      <button onClick={() => runCadenceNow(kind)} disabled={busy === `cadence-${kind}`} style={{ marginTop: 12, width: '100%', padding: '6px 10px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.4)', color: '#60a5fa', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600 }}>
                        {busy === `cadence-${kind}` ? '⏳ Running…' : `▶ Run ${kind} cycle now`}
                      </button>
                    </>}
                  </div>
                );
              })}
            </div>
            {editing && (
              <div style={{ padding: '0 20px 16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Timezone"><input type="text" value={baseline.timezone || 'Asia/Kolkata'} onChange={e => setBaselineField('timezone', e.target.value)} placeholder="IANA tz, e.g. Asia/Kolkata" style={inputStyle} /></Field>
                <div style={{ display: 'flex', alignItems: 'flex-end', color: '#64748b', fontSize: '0.7rem' }}>
                  Times above are interpreted in this timezone — "Thursday 22:00" means your Thursday, not UTC.
                </div>
              </div>
            )}
          </div>

          {/* Tab 2 — 6 priority areas */}
          <div className="glass-panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <h3 className="panel-title">🎯 Priority Areas — Custom Direction (6 weighted)</h3>
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
                          <span style={{ color: '#a855f7', fontWeight: 700 }}>weight {area.weight}</span>
                          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{pct}%</span>
                        </div>
                      )}
                    </div>
                    {editing ? <>
                      <p style={{ color: '#64748b', fontSize: '0.7rem', marginBottom: 10 }}>{AREA_DESCRIPTION[area.id as PriorityAreaId]}</p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <label style={{ color: '#94a3b8', fontSize: '0.75rem', minWidth: 80 }}>Weight (1-5)</label>
                        <input type="range" min={1} max={5} step={1} value={area.weight ?? 3} onChange={e => setAreaField(area.id, 'weight', Number(e.target.value))} style={{ flexGrow: 1 }} />
                        <span style={{ color: '#a855f7', fontWeight: 700, fontFamily: 'monospace', minWidth: 24 }}>{area.weight ?? 3}</span>
                        <span style={{ color: '#64748b', fontSize: '0.7rem', minWidth: 36 }}>{pct}%</span>
                      </div>
                      <Field label="Current state"><textarea value={area.current_state || ''} onChange={e => setAreaField(area.id, 'current_state', e.target.value)} placeholder="One line where-we-are." rows={2} style={textareaStyle} /></Field>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
                        <Field label="Target — 3 months"><textarea value={area.target_3mo || ''} onChange={e => setAreaField(area.id, 'target_3mo', e.target.value)} rows={3} style={textareaStyle} /></Field>
                        <Field label="Target — 6 months"><textarea value={area.target_6mo || ''} onChange={e => setAreaField(area.id, 'target_6mo', e.target.value)} rows={3} style={textareaStyle} /></Field>
                      </div>
                      <Field label="Notes"><textarea value={area.notes || ''} onChange={e => setAreaField(area.id, 'notes', e.target.value)} rows={2} style={textareaStyle} /></Field>
                    </> : <>
                      <div style={{ height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden', marginBottom: 10 }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg, #a855f7, #ec4899)' }} />
                      </div>
                      {area.current_state && <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5, marginBottom: 6 }}><strong style={{ color: '#cbd5e1' }}>Now:</strong> {String(area.current_state).slice(0, 150)}{String(area.current_state).length > 150 ? '…' : ''}</p>}
                      {area.target_3mo && <p style={{ color: '#94a3b8', fontSize: '0.78rem', lineHeight: 1.5 }}><strong style={{ color: '#34d399' }}>3mo:</strong> {String(area.target_3mo).slice(0, 130)}{String(area.target_3mo).length > 130 ? '…' : ''}</p>}
                      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: '0.7rem', color: '#64748b' }}>
                        <span>📍 {findingsHere} finding{findingsHere === 1 ? '' : 's'}</span>
                      </div>
                    </>}
                  </div>
                );
              })}
            </div>
          </div>

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
                        <div style={{ height: '100%', width: `${pct}%`, background: n > 0 ? 'linear-gradient(90deg, #3b82f6, #06b6d4)' : 'transparent' }} />
                      </div>
                      <span style={{ color: n > 0 ? '#06b6d4' : '#475569', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem', textAlign: 'right' }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ TAB 2: R&D Brief ═══ */}
      {activeTab === 'brief' && (
        <>
          <BriefForm busy={busy === 'brief'} onSubmit={submitBrief} />

          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">📚 Past briefs</h3>
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{state?.briefs?.length || 0} total</span>
            </div>
            <div className="panel-body">
              {(!state?.briefs || state.briefs.length === 0) && (
                <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>No briefs yet. Submit one above to give the architect a focused research task.</p>
              )}
              {(state?.briefs || []).map(b => (
                <div key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                      <strong style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem' }}>{b.id}</strong>
                      <span style={{ ...briefStatusStyle(b.status), fontSize: '0.65rem', padding: '2px 8px', borderRadius: 100 }}>{b.status}</span>
                      {b.priority_area && <span style={{ color: '#a855f7', fontSize: '0.7rem' }}>{AREA_ICON[b.priority_area as PriorityAreaId] || ''} {b.priority_area}</span>}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 4 }}>{b.title}</div>
                    <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                      submitted {new Date(b.submitted_at).toLocaleString()} · ${(b.budget_usd ?? 0).toFixed(2)}
                    </div>
                  </div>
                  {b.report_id && (
                    <button onClick={() => openReportById(b.report_id)} style={{ padding: '6px 12px', background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.5)', color: '#60a5fa', borderRadius: 6, fontSize: '0.75rem', cursor: 'pointer', fontWeight: 600, alignSelf: 'center' }}>
                      📄 View report
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ═══ TAB 3: Reports & Proposals ═══ */}
      {activeTab === 'reports' && (
        <>
          <div className="glass-panel" style={{ marginBottom: 20 }}>
            <div className="panel-header">
              <h3 className="panel-title">📊 Reports — cycle + brief ({state?.reports?.length || 0})</h3>
              <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{state?.unread_report_count || 0} unread</span>
            </div>
            <div className="panel-body">
              {(!state?.reports || state.reports.length === 0) && (
                <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>
                  No reports yet. Cadence cycles produce one each; R&D briefs produce one each.
                </p>
              )}
              {(state?.reports || []).map(r => (
                <div key={r.id} onClick={() => openReportById(r.id)} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 4 }}>
                      <strong style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: '0.8rem' }}>{r.id}</strong>
                      <span style={{ background: r.kind === 'brief' ? '#3b82f6' : '#a855f7', color: '#fff', padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>{r.kind === 'brief' ? 'Brief' : (r.cadence || 'cycle')}</span>
                      {!r.read_by_founder && <span style={{ background: 'rgba(59,130,246,0.2)', color: '#60a5fa', padding: '2px 8px', borderRadius: 100, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>● new</span>}
                    </div>
                    <div style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 4 }}>{r.title}</div>
                    <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                      {new Date(r.generated_at).toLocaleString()} · {r.linked_findings?.length ?? 0} findings · ${(r.cost_usd ?? 0).toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel">
            <div className="panel-header">
              <h3 className="panel-title">📨 Architect proposals ({(state?.proposals || []).length})</h3>
            </div>
            <div className="panel-body">
              {(!state?.proposals || state.proposals.length === 0) && (
                <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>No proposals yet.</p>
              )}
              {(state?.proposals || []).slice(0, 20).map(p => {
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
                    <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5, marginBottom: 6 }}>{p.rationale?.summary || p.change?.target || '(no summary)'}</div>
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
        </>
      )}

      {/* Report viewer modal */}
      {openReport && <ReportModal report={openReport} onClose={() => setOpenReport(null)} />}

      <div style={{ color: '#475569', fontSize: '0.7rem', textAlign: 'center', padding: 16 }}>
        KB at <code style={inlineCode}>{state?.kb_root}</code> · Phase 21-A.1 · {state?.paused ? '⏸ paused' : '▶ active'} · stub dispatcher (= $0) · 21-B will replace with Sonnet researcher
      </div>
    </div>
  );
};

const ReportModal: React.FC<{ report: any; onClose: () => void }> = ({ report, onClose }) => (
  <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
    <div onClick={e => e.stopPropagation()} className="glass-panel" style={{ maxWidth: 760, width: '90%', maxHeight: '85vh', overflowY: 'auto', background: 'rgba(15,23,42,0.95)' }}>
      <div className="panel-header" style={{ position: 'sticky', top: 0, background: 'rgba(15,23,42,0.95)', backdropFilter: 'blur(8px)', zIndex: 2 }}>
        <h3 className="panel-title">📄 {report.id} · {report.kind === 'brief' ? 'Brief Report' : `${report.cadence || 'Cycle'} Report`}</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '1.4rem' }}>×</button>
      </div>
      <div className="panel-body">
        <h2 style={{ color: '#e2e8f0', marginBottom: 8 }}>{report.title}</h2>
        <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 16 }}>
          Generated {new Date(report.generated_at).toLocaleString()} · ${(report.cost_usd ?? 0).toFixed(2)} · {report.linked_findings?.length ?? 0} findings
        </div>
        <p style={{ color: '#cbd5e1', lineHeight: 1.7, marginBottom: 20 }}>{report.summary}</p>
        {(report.sections || []).map((s: any, i: number) => (
          <div key={i} style={{ marginBottom: 18 }}>
            <h4 style={{ color: '#a855f7', marginBottom: 8 }}>{s.heading}</h4>
            <div style={{ color: '#cbd5e1', fontSize: '0.85rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{s.body}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

const SimplePageHeader: React.FC = () => (
  <div className="page-header">
    <div>
      <h1 className="page-title">Master Architect</h1>
      <p className="page-subtitle">Platform Evolution Roadmap · Founder R&D · Continuous Research (Phase 21-A.1)</p>
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
  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
    <span style={{ color: '#94a3b8', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</span>
    {children}
  </label>
);

const inputStyle: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: '0.85rem', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const textareaStyle: React.CSSProperties = { ...inputStyle, resize: 'vertical', minHeight: 50, lineHeight: 1.5 };
const inlineCode: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: '#fbbf24', fontFamily: 'monospace' };

const primaryBtn: React.CSSProperties = { padding: '12px 20px', background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' };
const secondaryBtn: React.CSSProperties = { padding: '12px 20px', background: 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.95rem' };
const smallBtn: React.CSSProperties = { padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', fontWeight: 600, cursor: 'pointer', fontSize: '0.75rem' };
const runBtn: React.CSSProperties = { padding: '6px 12px', background: 'linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.75rem' };
const saveBtn: React.CSSProperties = { padding: '6px 16px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.75rem' };

function prettyLabel(k: string) { return k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function briefStatusStyle(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    queued:    { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' },
    running:   { bg: 'rgba(59,130,246,0.15)',  fg: '#60a5fa' },
    completed: { bg: 'rgba(16,185,129,0.15)',  fg: '#34d399' },
    failed:    { bg: 'rgba(239,68,68,0.15)',   fg: '#f87171' },
    cancelled: { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' },
  };
  const c = map[status] || map.queued;
  return { background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase' };
}

export default MasterArchitect;
