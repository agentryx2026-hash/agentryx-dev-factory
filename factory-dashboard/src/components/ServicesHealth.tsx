import React, { useEffect, useState, useCallback } from 'react';

/**
 * Services Health — single-pane view of every factory service.
 *
 * Backend: GET /api/factory-admin/services/health  (UI-E)
 * Auto-refresh every 15s; manual refresh button.
 * Grouped by role: Own / Infra / Lab / External.
 */

interface ServiceRow {
  id: string;
  name: string;
  port: number | null;
  kind: 'http' | 'tcp' | 'absent' | 'external';
  console_url: string | null;
  has_console: boolean;
  role: 'own' | 'infra' | 'lab' | 'external';
  note: string;
  status: 'up' | 'degraded' | 'down' | 'absent' | 'external' | 'unknown';
  http_status?: number;
  latency_ms?: number;
  error?: string;
  checked_at?: string;
}

interface HealthResponse {
  services: ServiceRow[];
  summary: {
    total: number; up: number; degraded: number; down: number;
    absent: number; external: number; with_console: number;
  };
}

const sectionStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.6)',
  border: '1px solid rgba(255,255,255,0.05)',
  borderRadius: '12px',
  padding: '20px 24px',
  marginBottom: '20px',
};
const labelStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontWeight: 600,
  marginBottom: '8px',
};

const STATUS_META: Record<string, { dot: string; label: string; bg: string; fg: string }> = {
  up:       { dot: '#10b981', label: 'Up',         bg: 'rgba(16,185,129,0.15)',  fg: '#6ee7b7' },
  degraded: { dot: '#fbbf24', label: 'Degraded',   bg: 'rgba(251,191,36,0.2)',   fg: '#fde68a' },
  down:     { dot: '#ef4444', label: 'Down',       bg: 'rgba(239,68,68,0.2)',    fg: '#fca5a5' },
  absent:   { dot: '#64748b', label: 'Not deployed', bg: 'rgba(100,116,139,0.15)', fg: '#cbd5e1' },
  external: { dot: '#a5b4fc', label: 'External',   bg: 'rgba(99,102,241,0.15)',  fg: '#a5b4fc' },
  unknown:  { dot: '#64748b', label: 'Unknown',    bg: 'rgba(100,116,139,0.15)', fg: '#cbd5e1' },
};

const ROLE_LABEL: Record<string, string> = {
  own:      'Own services (built in this repo)',
  infra:    'Infra (Docker-hosted dependencies)',
  lab:      'Lab profiles (evaluation only — not in default deploy)',
  external: 'External — hosted dashboards',
};

const ServicesHealth: React.FC = () => {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/telemetry/factory-admin/services/health');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
      setLastFetched(new Date());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  const byRole: Record<string, ServiceRow[]> = {};
  for (const s of data?.services || []) {
    (byRole[s.role] = byRole[s.role] || []).push(s);
  }

  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Services Health</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Single-pane view of every factory service — own backends, Docker infra, Lab evaluation containers, and external hosted dashboards.
          {lastFetched && <> Last checked: <span style={{ color: '#cbd5e1' }}>{lastFetched.toLocaleTimeString()}</span></>}
        </p>
      </div>

      {/* Headline + controls */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '24px' }}>
            <Stat label="Total" value={data?.summary.total ?? '—'} />
            <Stat label="Up" value={data?.summary.up ?? '—'} color="#6ee7b7" />
            <Stat label="Degraded" value={data?.summary.degraded ?? 0} color={data?.summary.degraded ? '#fde68a' : '#94a3b8'} />
            <Stat label="Down" value={data?.summary.down ?? 0} color={data?.summary.down ? '#fca5a5' : '#94a3b8'} />
            <Stat label="Has Console" value={data?.summary.with_console ?? 0} color="#a5b4fc" />
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#94a3b8' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              Auto-refresh (15s)
            </label>
            <button onClick={load} disabled={loading} style={refreshBtn}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {err && (
        <div style={{ ...sectionStyle, background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {err}
        </div>
      )}

      {/* Grouped status grid */}
      {(['own', 'infra', 'lab', 'external'] as const).map(role => {
        const rows = byRole[role] || [];
        if (rows.length === 0) return null;
        return (
          <div key={role} style={sectionStyle}>
            <div style={labelStyle}>{ROLE_LABEL[role]}</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                  <th style={cellStyle}>Status</th>
                  <th style={cellStyle}>Service</th>
                  <th style={cellStyle}>Port</th>
                  <th style={cellStyle}>Latency</th>
                  <th style={cellStyle}>Note</th>
                  <th style={cellStyle}>Console</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(s => {
                  const meta = STATUS_META[s.status] || STATUS_META.unknown;
                  return (
                    <tr key={s.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td style={cellStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: meta.dot, boxShadow: s.status === 'up' ? `0 0 6px ${meta.dot}` : 'none' }} />
                          <span style={{ padding: '2px 8px', borderRadius: '4px', background: meta.bg, color: meta.fg, fontSize: '0.72rem' }}>{meta.label}</span>
                        </span>
                      </td>
                      <td style={cellStyle}>
                        <div style={{ color: '#f1f5f9' }}>{s.name}</div>
                        {s.error && <div style={{ color: '#fca5a5', fontSize: '0.7rem', marginTop: '2px' }}>{s.error}</div>}
                      </td>
                      <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#94a3b8' }}>{s.port || '—'}</td>
                      <td style={{ ...cellStyle, fontFamily: 'monospace', color: s.latency_ms && s.latency_ms > 500 ? '#fbbf24' : '#94a3b8' }}>
                        {s.latency_ms ? `${s.latency_ms}ms` : '—'}
                      </td>
                      <td style={{ ...cellStyle, color: '#cbd5e1', fontSize: '0.78rem' }}>{s.note}</td>
                      <td style={cellStyle}>
                        {s.console_url
                          ? <a href={s.console_url} target="_blank" rel="noreferrer" style={openBtn}>Open ↗</a>
                          : <span style={{ color: '#64748b', fontSize: '0.78rem' }}>API only</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}

      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '12px', fontStyle: 'italic' }}>
        Probe timeout: 4s. HTTP services use a real GET against a known health route; TCP services use a connect probe.
        Lab profiles + External show without a probe (status: Not deployed / External).
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: any; color?: string }> = ({ label, value, color }) => (
  <div>
    <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: 600, color: color || '#f1f5f9' }}>{value}</div>
  </div>
);

const cellStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
const refreshBtn: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '6px',
  padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem',
};
const openBtn: React.CSSProperties = {
  display: 'inline-block', padding: '3px 12px', borderRadius: '4px',
  background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99,102,241,0.25)', fontSize: '0.78rem',
  textDecoration: 'none',
};

export default ServicesHealth;
