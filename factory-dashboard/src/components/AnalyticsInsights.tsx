import React, { useEffect, useState } from 'react';

/**
 * Analytics & Insights — factory-pulse overview (was a static mock).
 *
 * Synthesizes live data from endpoints we've already wired across the
 * other admin/architect pages. No new backend; this page is composition
 * only — one place to glance at the factory's pulse without clicking
 * through 5 different pages. Auto-refreshes every 15s.
 */

const PRIORITY_AREAS = ['models', 'agents', 'languages', 'tools', 'output_quality', 'operations'] as const;
const AREA_ICON: Record<string, string> = {
  models: '🧠', agents: '🖖', languages: '🔤', tools: '🔧', output_quality: '✨', operations: '⚙️',
};

const AnalyticsInsights: React.FC = () => {
  const [arch, setArch] = useState<any>(null);
  const [flags, setFlags] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [cost, setCost] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [mem, setMem] = useState<any>(null);
  const [replay, setReplay] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const refresh = async () => {
    try {
      const [a, f, q, c, au, m, r] = await Promise.all([
        fetch('/telemetry/architect/state').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/flags').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/queue').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/cost').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/audit?limit=200').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/memory/scopes').then(x => x.ok ? x.json() : null).catch(() => null),
        fetch('/telemetry/factory-admin/replay/runs').then(x => x.ok ? x.json() : null).catch(() => null),
      ]);
      setArch(a); setFlags(f); setQueue(q); setCost(c); setAudit(au); setMem(m); setReplay(r);
      setLastRefresh(new Date());
      setErr(null);
    } catch (e: any) { setErr(e?.message || 'failed'); }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, []);

  const flagsOn = flags?.flags?.filter((f: any) => f.effective === 'on').length || 0;
  const flagsTotal = flags?.flags?.length || 0;
  const summary = arch?.summary || {};
  const findingsByArea: Record<string, number> = summary.findings_by_area || {};
  const maxArea = Math.max(1, ...Object.values(findingsByArea).map(n => Number(n) || 0));
  const totalFindings = summary.finding_count || 0;
  const auditCount = audit?.entries?.length || 0;
  const recentAudit = audit?.entries?.slice(0, 6) || [];

  return (
    <div className="fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">📈 Analytics & Insights</h1>
          <p className="page-subtitle">Factory pulse · synthesized from architect / admin / queue / cost / memory / replay</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastRefresh && <span style={{ color: '#64748b', fontSize: '0.7rem' }}>refreshed {lastRefresh.toLocaleTimeString()}</span>}
          <button onClick={refresh} style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#cbd5e1', fontSize: '0.7rem', cursor: 'pointer' }}>↻ Refresh</button>
        </div>
      </div>

      {err && <div style={errorBar}>{err}</div>}

      {/* Top stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
        <BigStat icon="👑" label="Standing Orders" value={arch?.standing_orders ? `v${arch.standing_orders.version}` : '—'} sub={arch?.paused ? '⏸ paused' : '▶ active'} color="#a855f7" />
        <BigStat icon="🛰" label="Research passes" value={summary.pass_count ?? 0} sub={summary.last_pass_at ? `last: ${new Date(summary.last_pass_at).toLocaleDateString()}` : 'none yet'} color="#3b82f6" />
        <BigStat icon="📍" label="Findings" value={totalFindings} sub={`${Object.keys(findingsByArea).filter(k => findingsByArea[k] > 0).length}/6 areas`} color="#06b6d4" />
        <BigStat icon="📨" label="Proposals" value={arch?.proposals?.length ?? 0} sub="architect-emitted" color="#10b981" />
        <BigStat icon="🔬" label="Briefs filed" value={arch?.briefs?.length ?? 0} sub="founder-driven" color="#ec4899" />
        <BigStat icon="📊" label="Reports" value={arch?.reports?.length ?? 0} sub={arch?.unread_report_count > 0 ? `${arch.unread_report_count} unread` : 'all read'} color="#f59e0b" />
        <BigStat icon="🚦" label="Flags ON" value={`${flagsOn}/${flagsTotal}`} sub="feature flags" color="#84cc16" />
        <BigStat icon="📦" label="Modules" value={15} sub="A-tier catalogued" color="#a78bfa" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📈 Findings by priority area</h3>
            <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{totalFindings} total · 6 areas</span>
          </div>
          <div className="panel-body">
            {totalFindings === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 24 }}>
                No findings yet. Run a research pass from the Master Architect page (or wait for the daily/weekly/monthly cadence) and they'll show up here.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {PRIORITY_AREAS.map(area => {
                  const n = findingsByArea[area] || 0;
                  const pct = (n / maxArea) * 100;
                  return (
                    <div key={area} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 40px', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: '#cbd5e1', fontSize: '0.78rem' }}>{AREA_ICON[area]} {area.replace(/_/g, ' ')}</span>
                      <div style={{ height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 5, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: n > 0 ? 'linear-gradient(90deg, #3b82f6, #06b6d4)' : 'transparent' }} />
                      </div>
                      <span style={{ color: n > 0 ? '#06b6d4' : '#475569', fontWeight: 700, fontFamily: 'monospace', fontSize: '0.85rem', textAlign: 'right' }}>{n}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">💰 Cost rollup</h3>
          </div>
          <div className="panel-body">
            {!cost?.rollup ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', padding: 16, textAlign: 'center' }}>
                $0 — no LLM calls yet. Lights up when the real Sonnet dispatcher (Phase 21-B) lands.
              </p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                <Stat label="Total" value={`$${(cost.rollup.total?.usd ?? 0).toFixed(2)}`} mono />
                <Stat label="Tokens" value={(cost.rollup.total?.tokens ?? 0).toLocaleString()} mono />
                <Stat label="Calls" value={cost.rollup.total?.calls ?? 0} mono />
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">📊 Concurrency (Phase 14-A)</h3>
          </div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <Stat label="Queued" value={queue?.stats?.queue ?? 0} mono />
            <Stat label="In flight" value={queue?.stats?.['in-flight'] ?? 0} mono />
            <Stat label="Done" value={queue?.stats?.done ?? 0} mono />
            <Stat label="Failed" value={queue?.stats?.failed ?? 0} mono />
          </div>
        </div>

        <div className="glass-panel">
          <div className="panel-header">
            <h3 className="panel-title">🧠 Memory + 🎬 Replay</h3>
          </div>
          <div className="panel-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <Stat label="Observations" value={mem?.total ?? 0} mono />
            <Stat label="Scopes" value={mem?.scopes?.length ?? 0} mono />
            <Stat label="Past runs" value={replay?.runs?.length ?? 0} mono />
          </div>
        </div>
      </div>

      <div className="glass-panel">
        <div className="panel-header">
          <h3 className="panel-title">📋 Recent admin activity ({auditCount})</h3>
          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>flag toggles · config writes · phase events</span>
        </div>
        <div className="panel-body">
          {recentAudit.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic', textAlign: 'center', padding: 16 }}>No admin activity recorded yet.</p>
          ) : recentAudit.map((e: any, i: number) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 12, padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.78rem' }}>
              <div style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.7rem' }}>{new Date(e.at).toLocaleString()}</div>
              <div>
                <span style={{ color: '#a855f7', fontWeight: 700 }}>{e.actor}</span>{' '}
                <code style={inlineCode}>{e.action}</code>{' '}
                {e.target && <>→ <code style={inlineCode}>{e.target}</code></>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ color: '#475569', fontSize: '0.7rem', textAlign: 'center', padding: 20 }}>
        Auto-refresh every 15s. Synthesized from /api/architect/state and /api/factory-admin/{'{'}flags, queue, cost, audit, memory, replay{'}'}.
      </div>
    </div>
  );
};

const BigStat: React.FC<{ icon: string; label: string; value: any; sub: string; color: string }> = ({ icon, label, value, sub, color }) => (
  <div style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${color}33`, borderRadius: 10, padding: 14 }}>
    <div style={{ fontSize: '1.4rem', marginBottom: 4 }}>{icon}</div>
    <div style={{ color, fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 }}>{label}</div>
    <div style={{ color: '#e2e8f0', fontSize: '1.4rem', fontWeight: 700, fontFamily: 'monospace', marginBottom: 4 }}>{value}</div>
    <div style={{ color: '#64748b', fontSize: '0.7rem' }}>{sub}</div>
  </div>
);

const Stat: React.FC<{ label: string; value: any; mono?: boolean }> = ({ label, value, mono }) => (
  <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 6, padding: '8px 10px' }}>
    <div style={{ color: '#64748b', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>
    <div style={{ color: '#e2e8f0', fontSize: '1.05rem', fontWeight: 700, fontFamily: mono ? 'monospace' : 'inherit' }}>{String(value)}</div>
  </div>
);

const errorBar: React.CSSProperties = { padding: 10, marginBottom: 12, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, color: '#f87171', fontSize: '0.8rem' };
const inlineCode: React.CSSProperties = { background: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: 4, fontSize: '0.85em', color: '#fbbf24', fontFamily: 'monospace' };

export default AnalyticsInsights;
