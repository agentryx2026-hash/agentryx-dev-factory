import React, { useEffect, useState } from 'react';

/**
 * Admin / Configuration page — Phase 12-B Tier B (added 2026-05-09).
 *
 * Replaces the prior placeholder (API-keys + agent-roster mockup with no save).
 * Six sub-tabs surface what the cognitive-engine modules already produce:
 *
 *   🚦 Flags    — 15 feature flags (live toggle, persisted via _factory_runtime/)
 *   ⚙️  Configs — 7 admin configs (read-only in Tier B; edit forms land in 12-B-full)
 *   📦 Modules  — Phase 18-A marketplace catalogue (15 built-in manifests)
 *   📊 Queue    — Phase 14-A queue depth + worker-pool state
 *   💰 Cost     — Phase 11-A cost rollup
 *   📋 Audit    — Phase 12-A audit log (admin actions across the factory)
 *
 * Backend: /api/factory-admin/{flags, flags/:env_var/toggle, configs, modules,
 *           queue, cost, audit}.
 *
 * What stays for 12-B-full (next session): role-gated edit forms on configs,
 * Postgres-backed config persistence. What stays for 13-B / 19-B: replay
 * timeline UI / customer admin views.
 */

type SubTab = 'flags' | 'configs' | 'modules' | 'queue' | 'cost' | 'verify' | 'courier' | 'audit';

const tabs: { key: SubTab; label: string }[] = [
  { key: 'flags',   label: '🚦 Flags' },
  { key: 'configs', label: '⚙️ Configs' },
  { key: 'modules', label: '📦 Modules' },
  { key: 'queue',   label: '📊 Queue' },
  { key: 'cost',    label: '💰 Cost' },
  { key: 'verify',  label: '✅ Verify' },
  { key: 'courier', label: '📡 Courier' },
  { key: 'audit',   label: '📋 Audit' },
];

const AdminConfig: React.FC = () => {
  const [active, setActive] = useState<SubTab>('flags');
  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin · Configuration</h1>
          <p className="page-subtitle">Phase 12-B Tier B — flags / configs / modules / queue / cost / audit</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid rgba(255,255,255,0.08)', marginBottom: 20 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            style={{
              padding: '10px 16px',
              background: active === t.key ? 'rgba(168,85,247,0.15)' : 'transparent',
              border: 'none',
              borderBottom: active === t.key ? '2px solid #a855f7' : '2px solid transparent',
              color: active === t.key ? '#e2e8f0' : '#94a3b8',
              fontWeight: active === t.key ? 700 : 500,
              cursor: 'pointer',
              fontSize: '0.85rem',
            }}
          >{t.label}</button>
        ))}
      </div>

      {active === 'flags'   && <FlagsPanel />}
      {active === 'configs' && <ConfigsPanel />}
      {active === 'modules' && <ModulesPanel />}
      {active === 'queue'   && <QueuePanel />}
      {active === 'cost'    && <CostPanel />}
      {active === 'verify'  && <VerifyPanel />}
      {active === 'courier' && <CourierPanel />}
      {active === 'audit'   && <AuditPanel />}
    </div>
  );
};

// ─── Flags ─────────────────────────────────────────────────────────────
const FlagsPanel: React.FC = () => {
  const [flags, setFlags] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch('/telemetry/factory-admin/flags');
      if (!r.ok) throw new Error(`flags returned ${r.status}`);
      const d = await r.json();
      setFlags(d.flags || []);
    } catch (e: any) { setErr(e?.message || 'failed to load flags'); }
  };
  useEffect(() => { refresh(); }, []);

  const toggle = async (envVar: string, current: 'on' | 'off') => {
    setBusy(envVar);
    try {
      const next = current === 'on' ? 'off' : 'on';
      const r = await fetch(`/telemetry/factory-admin/flags/${encodeURIComponent(envVar)}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: next, actor: 'founder' }),
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || `toggle failed: ${r.status}`);
      }
      await refresh();
    } catch (e: any) { setErr(e?.message || 'toggle failed'); }
    finally { setBusy(null); }
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">🚦 Feature flags ({flags.length})</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>persisted via _factory_runtime/flag_overrides.json</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {flags.map(f => (
          <div key={f.flag.env_var} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                <code style={{ ...inlineCode, fontSize: '0.85rem' }}>{f.flag.env_var}</code>
                <span style={{ color: '#64748b', fontSize: '0.7rem' }}>· {f.flag.owning_phase}</span>
                {f.override_source === 'ui' && <span style={{ background: 'rgba(168,85,247,0.2)', color: '#c4b5fd', padding: '1px 6px', borderRadius: 4, fontSize: '0.6rem', fontWeight: 700 }}>UI-SET</span>}
              </div>
              <div style={{ color: '#e2e8f0', fontSize: '0.85rem', marginBottom: 2 }}>{f.flag.display_name}</div>
              <div style={{ color: '#94a3b8', fontSize: '0.75rem', lineHeight: 1.5 }}>{f.flag.description}</div>
            </div>
            <button
              onClick={() => toggle(f.flag.env_var, f.effective)}
              disabled={busy === f.flag.env_var}
              style={{
                padding: '6px 14px',
                width: 80,
                background: f.effective === 'on' ? 'linear-gradient(135deg, #10b981, #059669)' : 'rgba(100,116,139,0.2)',
                border: f.effective === 'on' ? 'none' : '1px solid rgba(255,255,255,0.1)',
                color: f.effective === 'on' ? '#fff' : '#94a3b8',
                borderRadius: 100,
                fontWeight: 700,
                fontSize: '0.75rem',
                cursor: busy === f.flag.env_var ? 'not-allowed' : 'pointer',
                textTransform: 'uppercase',
              }}
            >
              {busy === f.flag.env_var ? '...' : f.effective}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Configs ───────────────────────────────────────────────────────────
const ConfigsPanel: React.FC = () => {
  const [configs, setConfigs] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // edit-mode draft text per config (raw JSON string the user is editing)
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const r = await fetch('/telemetry/factory-admin/configs');
      if (!r.ok) throw new Error(`configs returned ${r.status}`);
      const d = await r.json();
      setConfigs(d.configs || []);
    } catch (e: any) { setErr(e?.message || 'failed'); }
  };
  useEffect(() => { refresh(); }, []);

  const enterEdit = (id: string, value: any) => {
    setDrafts(prev => ({ ...prev, [id]: JSON.stringify(value, null, 2) }));
  };
  const cancelEdit = (id: string) => {
    setDrafts(prev => { const n = { ...prev }; delete n[id]; return n; });
    setSaveErr(prev => { const n = { ...prev }; delete n[id]; return n; });
  };
  const saveDraft = async (id: string) => {
    setBusy(id);
    setSaveErr(prev => { const n = { ...prev }; delete n[id]; return n; });
    try {
      let parsed: any;
      try { parsed = JSON.parse(drafts[id] || '{}'); }
      catch (e: any) { throw new Error(`invalid JSON: ${e?.message}`); }

      const r = await fetch(`/telemetry/factory-admin/configs/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: parsed, actor: 'founder', actor_role: 'super_admin' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `save failed: ${r.status}`);

      setFlash(`✅ Config ${id} saved (${d.bytes} bytes, sha256 ${String(d.sha256).slice(0, 12)}…)`);
      setTimeout(() => setFlash(null), 5000);
      cancelEdit(id);
      await refresh();
    } catch (e: any) {
      setSaveErr(prev => ({ ...prev, [id]: e?.message || 'save failed' }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">⚙️ Admin configs ({configs.length})</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>file-backed · role-gated edit · audited</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {flash && <div style={{ padding: 10, marginBottom: 12, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', borderRadius: 6, color: '#34d399', fontSize: '0.8rem' }}>{flash}</div>}
        {configs.map(({ entry, value, snapshot }) => {
          const isOpen = openId === entry.id;
          const isEditing = drafts[entry.id] !== undefined;
          const isSensitive = !!entry.sensitive;
          return (
            <div key={entry.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'baseline' }}>
                <div onClick={() => setOpenId(isOpen ? null : entry.id)} style={{ cursor: 'pointer' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2, flexWrap: 'wrap' }}>
                    <code style={{ ...inlineCode, fontSize: '0.85rem' }}>{entry.id}</code>
                    <span style={{ color: '#64748b', fontSize: '0.7rem' }}>
                      · {entry.category} · view ≥ <strong style={{ color: '#cbd5e1' }}>{entry.min_role_view}</strong> · edit ≥ <strong style={{ color: '#cbd5e1' }}>{entry.min_role_edit}</strong>
                      {entry.schema_version != null && <> · v{entry.schema_version}</>}
                    </span>
                    {isSensitive && <span style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', padding: '1px 6px', borderRadius: 4, fontSize: '0.6rem', fontWeight: 700 }}>SENSITIVE</span>}
                    {snapshot && <span style={{ color: '#475569', fontSize: '0.7rem', fontFamily: 'monospace' }}>· {snapshot.bytes}B</span>}
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5 }}>{entry.description || entry.display_name}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {isOpen && !isEditing && !isSensitive && (
                    <button onClick={() => enterEdit(entry.id, value)} style={editBtn}>✎ Edit</button>
                  )}
                  {isEditing && <>
                    <button onClick={() => cancelEdit(entry.id)} disabled={busy === entry.id} style={cancelBtn}>Cancel</button>
                    <button onClick={() => saveDraft(entry.id)} disabled={busy === entry.id} style={saveBtn}>{busy === entry.id ? '💾...' : '💾 Save'}</button>
                  </>}
                  <span style={{ color: '#94a3b8', fontSize: '0.7rem', cursor: 'pointer' }} onClick={() => setOpenId(isOpen ? null : entry.id)}>{isOpen ? '▼' : '▶'}</span>
                </div>
              </div>
              {isOpen && (
                <div style={{ marginTop: 10 }}>
                  {isEditing ? (
                    <>
                      <textarea
                        value={drafts[entry.id]}
                        onChange={e => setDrafts(prev => ({ ...prev, [entry.id]: e.target.value }))}
                        spellCheck={false}
                        style={{
                          width: '100%',
                          minHeight: 280,
                          padding: 12,
                          background: 'rgba(0,0,0,0.5)',
                          border: '1px solid rgba(168,85,247,0.4)',
                          borderRadius: 6,
                          color: '#e2e8f0',
                          fontSize: '0.78rem',
                          fontFamily: 'monospace',
                          lineHeight: 1.5,
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                      {saveErr[entry.id] && (
                        <div style={{ marginTop: 8, padding: 8, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, color: '#f87171', fontSize: '0.78rem' }}>
                          ⚠ {saveErr[entry.id]}
                        </div>
                      )}
                      <div style={{ marginTop: 6, color: '#64748b', fontSize: '0.7rem' }}>
                        Valid JSON required. Schema: must include <code style={inlineCode}>schema_version: {entry.schema_version}</code> if the entry declares one. Atomic write; audit entry on success.
                      </div>
                    </>
                  ) : (
                    <pre style={{ padding: 12, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, color: '#cbd5e1', fontSize: '0.75rem', overflowX: 'auto', maxHeight: 320, overflowY: 'auto', margin: 0 }}>
                      {value ? JSON.stringify(value, null, 2) : '(no value set yet)'}
                    </pre>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const editBtn: React.CSSProperties = { padding: '4px 12px', background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.5)', color: '#c4b5fd', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer', fontWeight: 600 };
const cancelBtn: React.CSSProperties = { padding: '4px 10px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer' };
const saveBtn: React.CSSProperties = { padding: '4px 12px', background: 'linear-gradient(135deg, #10b981, #059669)', border: 'none', color: '#fff', borderRadius: 4, fontSize: '0.7rem', cursor: 'pointer', fontWeight: 700 };

// ─── Modules ───────────────────────────────────────────────────────────
const ModulesPanel: React.FC = () => {
  const [modules, setModules] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/telemetry/factory-admin/modules')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`modules returned ${r.status}`)))
      .then(d => setModules(d.modules || []))
      .catch(e => setErr(e?.message || 'failed'));
  }, []);

  // Group by category
  const byCategory: Record<string, any[]> = {};
  for (const m of modules) {
    const cat = m.category || 'uncategorised';
    (byCategory[cat] = byCategory[cat] || []).push(m);
  }

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">📦 Module marketplace ({modules.length} catalogued)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Phase 18-A built-in manifests</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {Object.entries(byCategory).sort().map(([cat, mods]) => (
          <div key={cat} style={{ marginBottom: 18 }}>
            <h4 style={{ color: '#a855f7', marginBottom: 8, fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>{cat} ({mods.length})</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {mods.map(m => (
                <div key={m.id} style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                    <code style={{ ...inlineCode, fontSize: '0.78rem' }}>{m.id}</code>
                    <span style={statusPill(m.status)}>{m.status}</span>
                  </div>
                  <div style={{ color: '#cbd5e1', fontSize: '0.78rem', marginBottom: 4 }}>{m.display_name || m.name || m.id}</div>
                  <div style={{ color: '#64748b', fontSize: '0.7rem' }}>v{m.version} · {m.author || 'unknown'}</div>
                  {m.capabilities && (
                    <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {(Array.isArray(m.capabilities) ? m.capabilities : Object.keys(m.capabilities)).slice(0, 4).map((c: string, i: number) => (
                        <span key={i} style={{ background: 'rgba(255,255,255,0.04)', color: '#94a3b8', padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem' }}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Queue ─────────────────────────────────────────────────────────────
const QueuePanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitFlash, setSubmitFlash] = useState<string | null>(null);
  const [submitKind, setSubmitKind] = useState<'pre_dev' | 'dev' | 'post_dev'>('pre_dev');
  const [submitProject, setSubmitProject] = useState('');
  const [submitPayloadJson, setSubmitPayloadJson] = useState('{}');

  const refresh = () => fetch('/telemetry/factory-admin/queue')
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`queue returned ${r.status}`)))
    .then(setData)
    .catch(e => setErr(e?.message || 'failed'));

  const submitJob = async () => {
    setSubmitting(true);
    setErr(null);
    try {
      let payload = {};
      try { payload = JSON.parse(submitPayloadJson || '{}'); } catch (e: any) {
        throw new Error(`payload must be valid JSON: ${e?.message}`);
      }
      const r = await fetch('/telemetry/factory-admin/queue/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: submitKind, project_id: submitProject, payload }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `submit failed: ${r.status}`);
      setSubmitFlash(`✅ Enqueued ${d.job?.kind} job ${d.job?.id} for project "${d.job?.project_id}"`);
      setTimeout(() => setSubmitFlash(null), 6000);
      await refresh();
    } catch (e: any) {
      setErr(e?.message || 'submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  if (err && !data) return <div className="glass-panel"><div className="panel-body"><div style={errorBar}>{err}</div></div></div>;
  if (!data) return <div className="glass-panel"><div className="panel-body" style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading queue…</div></div>;

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">📊 Phase 14-A queue + worker pool (14-B Tier B: pre_dev / dev / post_dev handlers registered)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>auto-refresh every 5s</span>
      </div>
      <div className="panel-body">
        {submitFlash && <div style={{ marginBottom: 12, padding: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.5)', borderRadius: 6, color: '#34d399', fontSize: '0.8rem' }}>{submitFlash}</div>}
        {/* Submit-job form */}
        <details style={{ marginBottom: 18, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 8, padding: 12 }}>
          <summary style={{ cursor: 'pointer', color: '#c4b5fd', fontWeight: 600, fontSize: '0.85rem' }}>📥 Submit a job to the queue</summary>
          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '120px 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Kind</span>
              <select value={submitKind} onChange={e => setSubmitKind(e.target.value as any)} style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontSize: '0.78rem' }}>
                <option value="pre_dev">pre_dev</option>
                <option value="dev">dev</option>
                <option value="post_dev">post_dev</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Project ID</span>
              <input type="text" value={submitProject} onChange={e => setSubmitProject(e.target.value)} placeholder="e.g. 2026-05-10_test-project" style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontSize: '0.78rem' }} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ color: '#94a3b8', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5 }}>Payload (JSON)</span>
              <input type="text" value={submitPayloadJson} onChange={e => setSubmitPayloadJson(e.target.value)} placeholder='e.g. {"task":"build a TODO app"}' style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '6px 8px', color: '#e2e8f0', fontSize: '0.78rem', fontFamily: 'monospace' }} />
            </label>
            <button onClick={submitJob} disabled={submitting || !submitProject.trim()} style={{ padding: '6px 16px', background: submitting || !submitProject.trim() ? 'rgba(100,116,139,0.2)' : 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none', borderRadius: 4, color: '#fff', fontSize: '0.75rem', fontWeight: 700, cursor: submitting || !submitProject.trim() ? 'not-allowed' : 'pointer' }}>
              {submitting ? '⏳' : '📥 Submit'}
            </button>
          </div>
          <p style={{ marginTop: 8, color: '#64748b', fontSize: '0.7rem' }}>
            <strong>pre_dev</strong> needs <code style={inlineCode}>{`{"task":"<FRS text>"}`}</code>; <strong>dev</strong> + <strong>post_dev</strong> need <code style={inlineCode}>{`{"project":"<dir-name>"}`}</code>. Worker leases jobs every ~1s and spawns the corresponding graph; round-robin fairness across project_id.
          </p>
        </details>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
          <Stat label="Queued" value={data.stats?.queue ?? 0} mono />
          <Stat label="In flight" value={data.stats?.['in-flight'] ?? 0} mono />
          <Stat label="Done" value={data.stats?.done ?? 0} mono />
          <Stat label="Failed" value={data.stats?.failed ?? 0} mono />
        </div>
        <div>
          <h4 style={{ color: '#a855f7', marginBottom: 8, fontSize: '0.75rem', textTransform: 'uppercase' }}>Queued jobs ({data.queued?.length || 0})</h4>
          {(!data.queued || data.queued.length === 0) ? (
            <p style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>No queued jobs.</p>
          ) : data.queued.slice(0, 10).map((j: any) => (
            <div key={j.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', fontSize: '0.78rem' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <code style={inlineCode}>{j.id}</code>
                <span style={{ color: '#cbd5e1' }}>{j.kind}</span>
                <span style={{ color: '#64748b' }}>· project: {j.project_id || '—'}</span>
                <span style={{ color: '#a855f7', marginLeft: 'auto' }}>priority {j.priority ?? 50}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 18 }}>
          <h4 style={{ color: '#a855f7', marginBottom: 8, fontSize: '0.75rem', textTransform: 'uppercase' }}>In flight ({data.in_flight?.length || 0})</h4>
          {(!data.in_flight || data.in_flight.length === 0) ? (
            <p style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>No in-flight jobs.</p>
          ) : data.in_flight.slice(0, 10).map((j: any) => (
            <div key={j.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', fontSize: '0.78rem' }}>
              <code style={inlineCode}>{j.id}</code> {j.kind} · worker: <span style={{ color: '#34d399' }}>{j.leased_by}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ─── Cost ──────────────────────────────────────────────────────────────
const CostPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch('/telemetry/factory-admin/cost')
      .then(r => r.json())
      .then(setData)
      .catch(e => setErr(e?.message || 'failed'));
  }, []);

  if (!data) return <div className="glass-panel"><div className="panel-body" style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading cost…</div></div>;

  const r = data.rollup;
  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">💰 Cost rollup (Phase 11-A)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>source: artifacts</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {!r ? (
          <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', padding: 24, textAlign: 'center' }}>
            No cost data yet. Phase 11-A will populate this once real LLM calls produce artifacts (Cohort 1 — needs OpenRouter credit).
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
              <Stat label="Total cost" value={`$${(r.total?.usd ?? 0).toFixed(2)}`} mono />
              <Stat label="Total tokens" value={(r.total?.tokens ?? 0).toLocaleString()} mono />
              <Stat label="Calls" value={r.total?.calls ?? 0} mono />
            </div>
            {r.by_model && Object.keys(r.by_model).length > 0 && (
              <>
                <h4 style={{ color: '#a855f7', marginBottom: 8, fontSize: '0.75rem', textTransform: 'uppercase' }}>By model</h4>
                {Object.entries(r.by_model).map(([model, b]: [string, any]) => (
                  <div key={model} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 8, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
                    <span style={{ color: '#e2e8f0' }}>{model}</span>
                    <span style={{ color: '#34d399', textAlign: 'right' }}>${(b.usd ?? 0).toFixed(2)}</span>
                    <span style={{ color: '#cbd5e1', textAlign: 'right' }}>{(b.tokens ?? 0).toLocaleString()} tok</span>
                    <span style={{ color: '#64748b', textAlign: 'right' }}>{b.calls ?? 0}</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

// ─── Audit ─────────────────────────────────────────────────────────────
const AuditPanel: React.FC = () => {
  const [entries, setEntries] = useState<any[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const refresh = () => fetch('/telemetry/factory-admin/audit?limit=200')
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`audit returned ${r.status}`)))
    .then(d => setEntries(d.entries || []))
    .catch(e => setErr(e?.message || 'failed'));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">📋 Audit log ({entries.length} entries)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>Phase 12-A · auto-refresh every 10s</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {entries.length === 0 && <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', padding: 20, textAlign: 'center' }}>No audit entries yet. Toggle a flag to generate one.</p>}
        {entries.map((e, i) => (
          <div key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '10px 0', display: 'grid', gridTemplateColumns: '120px 1fr', gap: 12, fontSize: '0.78rem' }}>
            <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.7rem' }}>{new Date(e.at).toLocaleString()}</div>
            <div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                <span style={{ color: '#a855f7', fontWeight: 700 }}>{e.actor}</span>
                <code style={inlineCode}>{e.action}</code>
                {e.target && <span style={{ color: '#cbd5e1' }}>→ <code style={inlineCode}>{e.target}</code></span>}
              </div>
              {e.details && Object.keys(e.details).length > 0 && (
                <div style={{ color: '#94a3b8', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                  {JSON.stringify(e.details)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Verify ────────────────────────────────────────────────────────────
const VerifyPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch('/telemetry/factory-admin/verify/state')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`verify returned ${r.status}`)))
      .then(setData)
      .catch(e => setErr(e?.message || 'failed'));
  }, []);
  if (err) return <div className="glass-panel"><div className="panel-body"><div style={errorBar}>{err}</div></div></div>;
  if (!data) return <div className="glass-panel"><div className="panel-body" style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading…</div></div>;

  const decisionColor = (d: string) => d === 'pass' ? '#22c55e' : d === 'partial' ? '#f59e0b' : '#ef4444';

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">✅ Verify Integration (Phase 9-A + 9-B webhook)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>flag: <code style={inlineCode}>{data.flag_required}</code></span>
      </div>
      <div className="panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 14 }}>
          <Stat label="Enabled" value={data.enabled ? '● ON' : 'off'} />
          <Stat label="Client kind" value={data.client_kind || '—'} />
          <Stat label="Verify URL" value={data.verify_url || '— (mock)'} mono />
        </div>
        <div style={{ marginBottom: 16 }}>
          <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Review decisions</h4>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(data.review_decisions || []).map((d: string) => (
              <span key={d} style={{ background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', padding: '3px 10px', borderRadius: 100, fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 600 }}>{d}</span>
            ))}
          </div>
        </div>
        {data.webhook_url && (
          <div style={{ marginBottom: 14, padding: 10, background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6, fontSize: '0.78rem' }}>
            <div style={{ color: '#22c55e', fontWeight: 600, marginBottom: 4 }}>📥 Feedback webhook</div>
            <code style={{ ...inlineCode, color: '#cbd5e1', display: 'block', wordBreak: 'break-all' }}>POST {data.webhook_url || '/api/factory-admin/verify/webhook'}</code>
            <div style={{ color: '#94a3b8', marginTop: 4, fontSize: '0.72rem' }}>
              Body: <code style={inlineCode}>{'{ build_id, decision, reviewer, reviewed_at, project_id?, comments?, screenshot_urls?, review_item_id? }'}</code>
            </div>
          </div>
        )}
        <div style={{ padding: 10, background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, color: '#fbbf24', fontSize: '0.78rem', marginBottom: 14 }}>
          {data.note}
        </div>
        <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Recent published bundles ({data.recent_bundles?.length || 0})</h4>
        {(!data.recent_bundles || data.recent_bundles.length === 0) ? (
          <p style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>(none — mock store resets on telemetry restart; real Verify lands at 9-B)</p>
        ) : data.recent_bundles.map((b: any) => (
          <div key={b.build_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', fontSize: '0.78rem', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8 }}>
            <code style={inlineCode}>{b.build_id}</code>
            <span style={{ color: '#cbd5e1' }}>{b.project_id}</span>
            <span style={{ color: '#64748b' }}>{b.received_at ? new Date(b.received_at).toLocaleString() : ''}</span>
            <span style={{ color: '#a855f7', fontFamily: 'monospace' }}>seq {b.seq}</span>
          </div>
        ))}
        <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, margin: '18px 0 6px' }}>
          Recent feedback received ({data.recent_feedback?.length || 0})
        </h4>
        {(!data.recent_feedback || data.recent_feedback.length === 0) ? (
          <p style={{ color: '#64748b', fontSize: '0.8rem', fontStyle: 'italic', textAlign: 'center', padding: 20 }}>(none — webhook live but no hits yet; POST to the URL above to test)</p>
        ) : data.recent_feedback.map((f: any, i: number) => (
          <div key={`${f.build_id}-${i}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 0', fontSize: '0.78rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', gap: 8, alignItems: 'center' }}>
              <code style={inlineCode}>{f.build_id}</code>
              <span style={{ color: decisionColor(f.decision), fontWeight: 700, textTransform: 'uppercase', fontSize: '0.72rem' }}>{f.decision}</span>
              <span style={{ color: '#94a3b8' }}>{f.reviewer}</span>
              <span style={{ color: '#64748b' }}>{f.received_at ? new Date(f.received_at).toLocaleString() : ''}</span>
            </div>
            {(f.route_lane && f.route_lane !== 'none') && (
              <div style={{ color: '#a855f7', fontSize: '0.72rem', marginTop: 2 }}>
                → lane=<code style={inlineCode}>{f.route_lane}</code>{f.route_agent ? <> · agent=<code style={inlineCode}>{f.route_agent}</code></> : null}
              </div>
            )}
            {f.comments_preview && (
              <div style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '0.72rem', marginTop: 2 }}>"{f.comments_preview}"</div>
            )}
            {!f.ok && f.error && (
              <div style={{ color: '#ef4444', fontSize: '0.72rem', marginTop: 2 }}>⚠️ {f.error}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Courier ───────────────────────────────────────────────────────────
const CourierPanel: React.FC = () => {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch('/telemetry/factory-admin/courier/state')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`courier returned ${r.status}`)))
      .then(setData)
      .catch(e => setErr(e?.message || 'failed'));
  }, []);
  if (err) return <div className="glass-panel"><div className="panel-body"><div style={errorBar}>{err}</div></div></div>;
  if (!data) return <div className="glass-panel"><div className="panel-body" style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>Loading…</div></div>;

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">📡 Courier (Phase 10-A)</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>flag: <code style={inlineCode}>{data.flag_required}</code></span>
      </div>
      <div className="panel-body">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
          <Stat label="Enabled" value={data.enabled ? '● ON' : 'off'} />
          <Stat label="Event types" value={data.event_types?.length || 0} mono />
          <Stat label="Channels" value={data.channels?.length || 0} mono />
          <Stat label="Severities" value={data.severities?.length || 0} mono />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
          <div>
            <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Event types ({data.event_types?.length || 0})</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(data.event_types || []).map((e: string) => (
                <code key={e} style={{ ...inlineCode, fontSize: '0.72rem', display: 'block', padding: '4px 8px' }}>{e}</code>
              ))}
            </div>
          </div>
          <div>
            <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Channels ({data.channels?.length || 0})</h4>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {(data.channels || []).map((c: string) => (
                <span key={c} style={{ background: 'rgba(168,85,247,0.15)', color: '#c4b5fd', padding: '3px 10px', borderRadius: 100, fontSize: '0.75rem', textTransform: 'capitalize', fontWeight: 600 }}>{c}</span>
              ))}
            </div>
            <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 14 }}>Severities</h4>
            <div style={{ display: 'flex', gap: 6 }}>
              {(data.severities || []).map((s: string) => (
                <span key={s} style={{ background: s === 'error' ? 'rgba(239,68,68,0.15)' : s === 'warn' ? 'rgba(245,158,11,0.15)' : 'rgba(59,130,246,0.15)', color: s === 'error' ? '#f87171' : s === 'warn' ? '#fbbf24' : '#60a5fa', padding: '3px 10px', borderRadius: 100, fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>{s}</span>
              ))}
            </div>
          </div>
        </div>

        <h4 style={{ color: '#a855f7', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Routing config</h4>
        {data.routing?.error ? (
          <div style={{ padding: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4, color: '#f87171', fontSize: '0.78rem' }}>⚠ {data.routing.error}</div>
        ) : (
          <pre style={{ padding: 12, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, color: '#cbd5e1', fontSize: '0.72rem', overflowX: 'auto', maxHeight: 240, overflowY: 'auto', margin: 0 }}>
            {JSON.stringify(data.routing, null, 2)}
          </pre>
        )}

        <div style={{ padding: 10, marginTop: 14, background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, color: '#fbbf24', fontSize: '0.78rem' }}>
          {data.note}
        </div>
      </div>
    </div>
  );
};

// ─── Helpers ───────────────────────────────────────────────────────────
const Stat: React.FC<{ label: string; value: any; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '8px 10px' }}>
    <div style={{ color: '#64748b', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
    <div style={{ color: '#e2e8f0', fontSize: '1.05rem', fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value)}</div>
  </div>
);

const inlineCode: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: '#fbbf24', fontFamily: 'monospace' };
const errorBar: React.CSSProperties = { padding: 10, marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, color: '#f87171', fontSize: '0.8rem' };

function statusPill(status: string): React.CSSProperties {
  const map: Record<string, { bg: string; fg: string }> = {
    installed:    { bg: 'rgba(16,185,129,0.15)', fg: '#34d399' },
    catalogued:   { bg: 'rgba(59,130,246,0.15)', fg: '#60a5fa' },
    experimental: { bg: 'rgba(245,158,11,0.15)', fg: '#fbbf24' },
    deprecated:   { bg: 'rgba(239,68,68,0.15)',  fg: '#f87171' },
  };
  const c = map[status] || { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' };
  return { background: c.bg, color: c.fg, fontWeight: 700, textTransform: 'uppercase', fontSize: '0.6rem', padding: '1px 6px', borderRadius: 4 };
}

export default AdminConfig;
