import React, { useEffect, useState, useCallback } from 'react';

/**
 * Notifications — Courier event-history viewer (Phase 10-A / 19-B D230+D231).
 *
 * UI-D wires this to the shared module-level Courier in telemetry.mjs via
 *   GET /api/factory-admin/courier/state    — taxonomy + last 20 events
 *   GET /api/factory-admin/courier/history  — full history + filters
 *
 * The fake backend records every dispatch in memory; this view surfaces
 * it so the founder can see notifications as they fire. When 10-B
 * Hermes/Slack/SMTP backends land (COURIER_BACKEND=http) the same view
 * works unchanged — only the backend label changes.
 */

interface CourierEventRow {
  event: {
    id: string;
    type: string;
    severity?: string;
    title?: string;
    body?: string;
    project_id?: string;
    meta?: Record<string, any>;
    emitted_at?: string;
  };
  result: {
    ok: boolean;
    event_id: string;
    channels_used?: string[];
    deliveries?: Array<{ channel: string; target?: string; ok: boolean; error?: string }>;
    dropped?: boolean;
    reason?: string;
    error?: string;
  };
}

interface HistoryResponse {
  events: CourierEventRow[];
  count: number;
  total_unfiltered: number;
  backend_kind: string | null;
  error?: string;
}

const KNOWN_TYPES = [
  '',
  'customer.submission_received',
  'customer.submission_accepted',
  'customer.submission_delivered',
  'customer.sla_breached',
  'customer.submission_cancelled',
  'customer.submission_rejected',
  // factory-side types remain available for filtering when they fire
  'project.pr_opened',
  'project.deployment_ready',
  'project.delivery_ready',
  'verify.feedback_received',
  'cost.budget_exceeded',
  'cost.threshold_warn',
  'agent.error_rate_spike',
  'factory.smoke_test',
];

const SEVERITIES = ['', 'info', 'warn', 'error'];

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
const severityPill = (sev?: string): React.CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    info:  { bg: 'rgba(99, 102, 241, 0.2)', fg: '#a5b4fc' },
    warn:  { bg: 'rgba(245, 158, 11, 0.2)', fg: '#fde68a' },
    error: { bg: 'rgba(239, 68, 68, 0.2)',  fg: '#fca5a5' },
  };
  const c = map[sev || 'info'] || map.info;
  return { padding: '2px 8px', borderRadius: '4px', background: c.bg, color: c.fg, fontSize: '0.72rem' };
};
const channelPill: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: '3px',
  background: 'rgba(16, 185, 129, 0.15)',
  color: '#6ee7b7',
  fontSize: '0.7rem',
  marginRight: '4px',
  fontFamily: 'monospace',
};
const typePill: React.CSSProperties = {
  fontFamily: 'monospace',
  color: '#10b981',
  fontSize: '0.82rem',
};

const Notifications: React.FC = () => {
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [openEvent, setOpenEvent] = useState<CourierEventRow | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter)     params.set('type', typeFilter);
      if (severityFilter) params.set('severity', severityFilter);
      params.set('limit', '200');
      const res = await fetch(`/telemetry/factory-admin/courier/history?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [typeFilter, severityFilter]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 8s. Set short enough that founders see new events
  // arrive; long enough that it isn't visible spinning.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [autoRefresh, load]);

  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Notifications</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Live feed of every Courier event the factory dispatches.
          {data?.backend_kind && (
            <> Backend: <code>{data.backend_kind}</code> {data.backend_kind === 'fake' && <span style={{ color: '#fde68a' }}>(v0.0.1 default: in-memory; events visible here but not delivered externally)</span>}</>
          )}
        </p>
      </div>

      {/* Filter controls + summary */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '24px' }}>
            <Stat label="Events shown" value={data?.count ?? '—'} />
            <Stat label="Total in history" value={data?.total_unfiltered ?? '—'} />
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <FilterSelect label="Type" value={typeFilter} onChange={setTypeFilter} options={KNOWN_TYPES} />
            <FilterSelect label="Severity" value={severityFilter} onChange={setSeverityFilter} options={SEVERITIES} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: '#94a3b8', cursor: 'pointer' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
              Auto-refresh (8s)
            </label>
            <button onClick={load} disabled={loading} style={refreshBtn}>↻ Refresh</button>
          </div>
        </div>
      </div>

      {err && (
        <div style={{ ...sectionStyle, background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {err}
        </div>
      )}

      {/* Events list */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Recent events (newest first)</div>
        {loading && !data && <div style={{ color: '#94a3b8' }}>Loading…</div>}
        {data && data.events.length === 0 && (
          <div style={{ color: '#94a3b8', fontStyle: 'italic', padding: '24px 0', textAlign: 'center' }}>
            <p>No events match the filters.</p>
            <p style={{ fontSize: '0.78rem', marginTop: '8px' }}>
              The Courier history is in-memory + per-process; it resets on telemetry restart.
              Events accumulate as the factory dispatches them — try submitting via the customer
              portal HTTP route, or wait for the next SLA scanner tick (every 5 minutes).
            </p>
          </div>
        )}
        {data && data.events.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={cellStyle}>EVT</th>
                <th style={cellStyle}>Type</th>
                <th style={cellStyle}>Severity</th>
                <th style={cellStyle}>Title</th>
                <th style={cellStyle}>Channels</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>When</th>
              </tr>
            </thead>
            <tbody>
              {data.events.map((e, i) => {
                const t = e.event;
                const r = e.result;
                const failed = r.ok === false;
                const dropped = r.dropped === true;
                return (
                  <tr
                    key={`${t.id}-${i}`}
                    onClick={() => setOpenEvent(e)}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: openEvent?.event.id === t.id ? 'rgba(99,102,241,0.05)' : 'transparent' }}
                  >
                    <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#a5b4fc' }}>{t.id}</td>
                    <td style={{ ...cellStyle, ...typePill }}>{t.type}</td>
                    <td style={cellStyle}><span style={severityPill(t.severity)}>{t.severity || 'info'}</span></td>
                    <td style={{ ...cellStyle, maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title || <span style={{ color: '#64748b', fontStyle: 'italic' }}>(no title)</span>}</td>
                    <td style={cellStyle}>
                      {(r.channels_used || []).map(ch => <span key={ch} style={channelPill}>{ch}</span>)}
                    </td>
                    <td style={cellStyle}>
                      {failed
                        ? <span style={severityPill('error')}>failed</span>
                        : dropped
                          ? <span style={severityPill('warn')}>dropped</span>
                          : <span style={{ ...severityPill('info'), background: 'rgba(16,185,129,0.15)', color: '#6ee7b7' }}>delivered</span>}
                    </td>
                    <td style={{ ...cellStyle, color: '#94a3b8', fontSize: '0.78rem' }}>{t.emitted_at ? new Date(t.emitted_at).toLocaleTimeString() : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {openEvent && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={labelStyle}>Event detail — {openEvent.event.id} · {openEvent.event.type}</div>
            <button onClick={() => setOpenEvent(null)} style={smallBtn}>✕ Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <div style={{ ...labelStyle, marginTop: 0 }}>Event payload</div>
              <pre style={preStyle}>{JSON.stringify(openEvent.event, null, 2)}</pre>
            </div>
            <div>
              <div style={{ ...labelStyle, marginTop: 0 }}>Delivery result</div>
              <pre style={preStyle}>{JSON.stringify(openEvent.result, null, 2)}</pre>
              {openEvent.event.body && (
                <>
                  <div style={{ ...labelStyle, marginTop: '12px' }}>Body (markdown)</div>
                  <pre style={{ ...preStyle, whiteSpace: 'pre-wrap' }}>{openEvent.event.body}</pre>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '12px', fontStyle: 'italic' }}>
        Sources: D230 SLA scanner (customer.sla_breached) · D231 HTTP /submit + /cancel (customer.submission_received + customer.submission_cancelled).
        D232 (intake + back-feed) and D233 (admin reject) wire onAccepted / onDelivered / onRejected per follow-on ships.
        Set <code>COURIER_BACKEND=http</code> + Hermes credentials for real Slack/email delivery (10-B).
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: any }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: '0.65rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f1f5f9' }}>{value}</div>
  </div>
);

const FilterSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: string[] }> = ({ label, value, onChange, options }) => (
  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.7rem', color: '#64748b' }}>
    <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
      {options.map(opt => <option key={opt} value={opt}>{opt || 'all'}</option>)}
    </select>
  </label>
);

const cellStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
const selectStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
  padding: '4px 8px', fontSize: '0.82rem',
};
const refreshBtn: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '6px',
  padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem',
};
const smallBtn: React.CSSProperties = {
  background: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1',
  border: '1px solid rgba(100, 116, 139, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.78rem',
};
const preStyle: React.CSSProperties = {
  background: 'rgba(2, 6, 23, 0.6)', color: '#cbd5e1',
  padding: '10px 12px', borderRadius: '6px', fontSize: '0.75rem',
  overflowX: 'auto', margin: 0, maxHeight: '380px',
};

export default Notifications;
