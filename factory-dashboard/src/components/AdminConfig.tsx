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

type SubTab = 'flags' | 'configs' | 'modules' | 'queue' | 'cost' | 'audit';

const tabs: { key: SubTab; label: string }[] = [
  { key: 'flags',   label: '🚦 Flags' },
  { key: 'configs', label: '⚙️ Configs' },
  { key: 'modules', label: '📦 Modules' },
  { key: 'queue',   label: '📊 Queue' },
  { key: 'cost',    label: '💰 Cost' },
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

  useEffect(() => {
    fetch('/telemetry/factory-admin/configs')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`configs returned ${r.status}`)))
      .then(d => setConfigs(d.configs || []))
      .catch(e => setErr(e?.message || 'failed'));
  }, []);

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h3 className="panel-title">⚙️ Admin configs ({configs.length})</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>read-only in Tier B · edit forms land in 12-B-full</span>
      </div>
      <div className="panel-body">
        {err && <div style={errorBar}>{err}</div>}
        {configs.map(({ entry, value }) => (
          <div key={entry.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '12px 0' }}>
            <div onClick={() => setOpenId(openId === entry.id ? null : entry.id)} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, cursor: 'pointer', alignItems: 'baseline' }}>
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 2 }}>
                  <code style={{ ...inlineCode, fontSize: '0.85rem' }}>{entry.id}</code>
                  <span style={{ color: '#64748b', fontSize: '0.7rem' }}>· {entry.category} · view: {entry.view_role} · edit: {entry.edit_role}</span>
                </div>
                <div style={{ color: '#cbd5e1', fontSize: '0.8rem', lineHeight: 1.5 }}>{entry.description || entry.display_name}</div>
              </div>
              <span style={{ color: '#94a3b8', fontSize: '0.7rem' }}>{openId === entry.id ? '▼' : '▶'}</span>
            </div>
            {openId === entry.id && (
              <pre style={{ marginTop: 10, padding: 12, background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, color: '#cbd5e1', fontSize: '0.75rem', overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                {value ? JSON.stringify(value, null, 2) : '(no value set yet)'}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

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

  const refresh = () => fetch('/telemetry/factory-admin/queue')
    .then(r => r.ok ? r.json() : Promise.reject(new Error(`queue returned ${r.status}`)))
    .then(setData)
    .catch(e => setErr(e?.message || 'failed'));

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
        <h3 className="panel-title">📊 Phase 14-A queue + worker pool</h3>
        <span style={{ color: '#64748b', fontSize: '0.7rem' }}>auto-refresh every 5s</span>
      </div>
      <div className="panel-body">
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
