import React, { useEffect, useState, useCallback } from 'react';

/**
 * Customer Portal — admin view of submissions across all customers
 * (Phase 19-B). Built in PR-C against the new admin endpoints:
 *   GET  /api/customer-portal/admin/customers
 *   GET  /api/customer-portal/admin/submissions  (+ status/tier filters)
 *   GET  /api/customer-portal/admin/submissions/:cid/:sid (detail)
 *   POST /api/customer-portal/admin/submissions/:cid/:sid/cancel
 */

interface SlaStatus {
  status: 'on_track' | 'at_risk' | 'breached' | 'completed';
  elapsed_hours: number;
  remaining_hours: number;
  percent_elapsed: number;
  missed_sla?: boolean;
}

interface SubmissionRow {
  id: string;
  customer_id: string;
  customer_email?: string;
  tier?: string;
  project_title: string;
  status: string;
  submitted_at: string;
  target_delivery_at: string;
  sla_status?: SlaStatus | null;
  downstream_pre_dev_job_id?: string;
  delivered_by_job_id?: string;
}

interface AdminSubmissionsResponse {
  submissions: SubmissionRow[];
  counts: {
    total: number;
    by_status: Record<string, number>;
    by_tier:   Record<string, number>;
    breached:  number;
  };
}

interface TimelineEvent {
  at: string;
  kind: string;
  note?: string;
  phase?: string;
  computed_eta_at?: string;
}

interface DetailResponse {
  submission: any;
  account: any | null;
  timeline: TimelineEvent[];
  sla_status: SlaStatus | null;
}

const STATUS_OPTIONS = ['', 'submitted', 'accepted', 'in_progress', 'delivered', 'cancelled', 'rejected'];
const TIER_OPTIONS   = ['', 'free', 'starter', 'pro'];

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
const statusPillStyle = (s: string): React.CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    submitted:   { bg: 'rgba(99, 102, 241, 0.2)', fg: '#a5b4fc' },
    accepted:    { bg: 'rgba(99, 102, 241, 0.2)', fg: '#a5b4fc' },
    in_progress: { bg: 'rgba(245, 158, 11, 0.2)', fg: '#fde68a' },
    delivered:   { bg: 'rgba(16, 185, 129, 0.2)', fg: '#6ee7b7' },
    cancelled:   { bg: 'rgba(100, 116, 139, 0.2)', fg: '#cbd5e1' },
    rejected:    { bg: 'rgba(239, 68, 68, 0.2)',  fg: '#fca5a5' },
  };
  const c = map[s] || { bg: 'rgba(100,116,139,0.2)', fg: '#94a3b8' };
  return { padding: '2px 8px', borderRadius: '4px', background: c.bg, color: c.fg, fontSize: '0.75rem', fontFamily: 'monospace' };
};
const slaPillStyle = (s?: string): React.CSSProperties => {
  const map: Record<string, { bg: string; fg: string }> = {
    on_track:  { bg: 'rgba(16, 185, 129, 0.15)', fg: '#6ee7b7' },
    at_risk:   { bg: 'rgba(245, 158, 11, 0.2)',  fg: '#fde68a' },
    breached:  { bg: 'rgba(239, 68, 68, 0.25)',  fg: '#fca5a5' },
    completed: { bg: 'rgba(99, 102, 241, 0.15)', fg: '#a5b4fc' },
  };
  const c = map[s || ''] || { bg: 'rgba(100,116,139,0.15)', fg: '#94a3b8' };
  return { padding: '2px 8px', borderRadius: '4px', background: c.bg, color: c.fg, fontSize: '0.72rem' };
};
const cellStyle: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'top' };

const CustomerPortal: React.FC = () => {
  const [data, setData] = useState<AdminSubmissionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [openDetail, setOpenDetail] = useState<DetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (tierFilter)   params.set('tier', tierFilter);
      const res = await fetch(`/telemetry/customer-portal/admin/submissions?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setData(body);
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, tierFilter]);

  useEffect(() => { load(); }, [load]);

  const openSubmission = async (customerId: string, submissionId: string) => {
    setDetailLoading(true);
    setOpenDetail(null);
    try {
      const res = await fetch(`/telemetry/customer-portal/admin/submissions/${encodeURIComponent(customerId)}/${encodeURIComponent(submissionId)}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setOpenDetail(body);
    } catch (e: any) {
      setErr(e?.message || 'detail load failed');
    } finally {
      setDetailLoading(false);
    }
  };

  const cancelSubmission = async (customerId: string, submissionId: string) => {
    const note = window.prompt('Cancellation note (optional):', 'cancelled by admin');
    if (note === null) return;  // user pressed Cancel on the prompt
    setBusy(`cancel-${submissionId}`);
    try {
      const res = await fetch(
        `/telemetry/customer-portal/admin/submissions/${encodeURIComponent(customerId)}/${encodeURIComponent(submissionId)}/cancel`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ note }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setFlashMsg(`✅ Cancelled ${submissionId}`);
      setTimeout(() => setFlashMsg(null), 4000);
      setOpenDetail(null);
      await load();
    } catch (e: any) {
      setErr(`Cancel failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  // D233 — admin reject with reason. Terminal; fires
  // customer.submission_rejected Courier event via the notifier wiring.
  const rejectSubmission = async (customerId: string, submissionId: string) => {
    const reason = window.prompt(
      'Reject this submission?\n\nReason (will be saved to the timeline + notification):',
      ''
    );
    if (reason === null) return;
    if (!reason.trim()) { alert('Reason required for reject.'); return; }
    if (!window.confirm(`Confirm REJECT of ${submissionId}?\n\nThis is a terminal action — customer would need to resubmit a fresh project.\n\nReason:\n${reason}`)) return;
    setBusy(`reject-${submissionId}`);
    try {
      const res = await fetch(
        `/telemetry/customer-portal/admin/submissions/${encodeURIComponent(customerId)}/${encodeURIComponent(submissionId)}/reject`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
      setFlashMsg(`🚫 Rejected ${submissionId}`);
      setTimeout(() => setFlashMsg(null), 4000);
      setOpenDetail(null);
      await load();
    } catch (e: any) {
      setErr(`Reject failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Customer Portal</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Admin view of submissions across all customers. Driven by Phase 19-B substrate
          (D224 intake · D225 HTTP surface · D227 back-feed · D228 SLA scanner · D230/D231 notifier).
        </p>
      </div>

      {flashMsg && (
        <div style={{ ...sectionStyle, background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#6ee7b7', marginBottom: '12px' }}>
          {flashMsg}
        </div>
      )}

      {/* Summary counts + filter controls */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <Stat label="Total"        value={data?.counts.total ?? '—'} />
            <Stat label="In Progress"  value={data?.counts.by_status?.in_progress ?? 0} />
            <Stat label="Delivered"    value={data?.counts.by_status?.delivered ?? 0} color="#6ee7b7" />
            <Stat label="Cancelled"    value={data?.counts.by_status?.cancelled ?? 0} color="#cbd5e1" />
            <Stat label="Breached"     value={data?.counts.breached ?? 0} color="#fca5a5" />
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
            <FilterSelect label="Tier"   value={tierFilter}   onChange={setTierFilter}   options={TIER_OPTIONS} />
            <button onClick={load} disabled={loading} style={refreshBtn}>{loading ? '⏳' : '↻'} Refresh</button>
          </div>
        </div>
      </div>

      {err && (
        <div style={{ ...sectionStyle, background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239,68,68,0.3)', color: '#fca5a5' }}>
          {err}
        </div>
      )}

      {/* Submissions table */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Submissions ({data?.submissions.length ?? 0})</div>
        {loading && !data && <div style={{ color: '#94a3b8' }}>Loading…</div>}
        {data && data.submissions.length === 0 && (
          <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>No submissions match the filters.</div>
        )}
        {data && data.submissions.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={cellStyle}>Customer</th>
                <th style={cellStyle}>Submission</th>
                <th style={cellStyle}>Project</th>
                <th style={cellStyle}>Status</th>
                <th style={cellStyle}>SLA</th>
                <th style={cellStyle}>Submitted</th>
                <th style={cellStyle}>Target</th>
                <th style={cellStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.submissions.map(s => {
                const isTerminal = ['delivered', 'cancelled', 'rejected'].includes(s.status);
                return (
                  <tr key={`${s.customer_id}_${s.id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={cellStyle}>
                      <div style={{ fontFamily: 'monospace', color: '#10b981', fontSize: '0.8rem' }}>{s.customer_id}</div>
                      {s.customer_email && <div style={{ color: '#94a3b8', fontSize: '0.72rem' }}>{s.customer_email}</div>}
                      {s.tier && <div style={{ marginTop: '2px' }}><span style={{ ...slaPillStyle('completed'), fontSize: '0.68rem' }}>{s.tier}</span></div>}
                    </td>
                    <td style={{ ...cellStyle, fontFamily: 'monospace', color: '#a5b4fc' }}>{s.id}</td>
                    <td style={cellStyle}>{s.project_title || <span style={{ color: '#64748b', fontStyle: 'italic' }}>(no title)</span>}</td>
                    <td style={cellStyle}><span style={statusPillStyle(s.status)}>{s.status}</span></td>
                    <td style={cellStyle}>
                      {s.sla_status
                        ? <span style={slaPillStyle(s.sla_status.status)}>{s.sla_status.status} · {Math.round(s.sla_status.percent_elapsed * 100)}%</span>
                        : <span style={{ color: '#64748b' }}>—</span>}
                    </td>
                    <td style={{ ...cellStyle, color: '#94a3b8', fontSize: '0.78rem' }}>{new Date(s.submitted_at).toLocaleString()}</td>
                    <td style={{ ...cellStyle, color: '#94a3b8', fontSize: '0.78rem' }}>{new Date(s.target_delivery_at).toLocaleString()}</td>
                    <td style={cellStyle}>
                      <button onClick={() => openSubmission(s.customer_id, s.id)} style={detailBtn}>Detail</button>
                      {!isTerminal && (
                        <>
                          <button
                            onClick={() => cancelSubmission(s.customer_id, s.id)}
                            disabled={busy === `cancel-${s.id}`}
                            style={cancelBtn}
                          >
                            {busy === `cancel-${s.id}` ? '⏳' : 'Cancel'}
                          </button>
                          <button
                            onClick={() => rejectSubmission(s.customer_id, s.id)}
                            disabled={busy === `reject-${s.id}`}
                            style={rejectBtn}
                            title="Admin reject — terminal, fires customer.submission_rejected notification"
                          >
                            {busy === `reject-${s.id}` ? '⏳' : 'Reject'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail drawer */}
      {(openDetail || detailLoading) && (
        <div style={sectionStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={labelStyle}>
              Submission detail{openDetail?.submission?.id ? ` — ${openDetail.submission.customer_id}/${openDetail.submission.id}` : ''}
            </div>
            <button onClick={() => setOpenDetail(null)} style={smallBtn}>✕ Close</button>
          </div>
          {detailLoading && <div style={{ color: '#94a3b8' }}>Loading…</div>}
          {openDetail && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <div style={{ ...labelStyle, marginTop: 0 }}>Record</div>
                <pre style={preStyle}>{JSON.stringify(openDetail.submission, null, 2)}</pre>
                {openDetail.account && (
                  <>
                    <div style={{ ...labelStyle, marginTop: '12px' }}>Account</div>
                    <pre style={preStyle}>{JSON.stringify(openDetail.account, null, 2)}</pre>
                  </>
                )}
                {openDetail.sla_status && (
                  <>
                    <div style={{ ...labelStyle, marginTop: '12px' }}>SLA</div>
                    <pre style={preStyle}>{JSON.stringify(openDetail.sla_status, null, 2)}</pre>
                  </>
                )}
              </div>
              <div>
                <div style={{ ...labelStyle, marginTop: 0 }}>Timeline ({openDetail.timeline.length} events)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '600px', overflowY: 'auto' }}>
                  {openDetail.timeline.map((e, i) => (
                    <div key={i} style={{ background: 'rgba(15,23,42,0.5)', padding: '10px 12px', borderRadius: '6px', borderLeft: `3px solid ${timelineColor(e.kind)}`, fontSize: '0.82rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <span style={{ ...statusPillStyle(e.kind), fontSize: '0.7rem' }}>{e.kind}</span>
                        <span style={{ color: '#64748b', fontSize: '0.72rem' }}>{new Date(e.at).toLocaleString()}</span>
                      </div>
                      {e.phase && <div style={{ color: '#a5b4fc', fontSize: '0.78rem' }}>phase: {e.phase}</div>}
                      {e.note  && <div style={{ color: '#cbd5e1' }}>{e.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Footer note */}
      <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '12px', fontStyle: 'italic' }}>
        Endpoints: <code>/api/customer-portal/admin/{`{customers,submissions,submissions/:cid/:sid,submissions/:cid/:sid/cancel}`}</code> · v0.0.1 admin surface; Phase 22 hardens with auth.
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

const FilterSelect: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: string[] }> = ({ label, value, onChange, options }) => (
  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.7rem', color: '#64748b' }}>
    <span style={{ textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>{label}</span>
    <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle}>
      {options.map(opt => <option key={opt} value={opt}>{opt || 'all'}</option>)}
    </select>
  </label>
);

const timelineColor = (kind: string): string => {
  const c: Record<string, string> = {
    submitted: '#a5b4fc', accepted: '#a5b4fc',
    phase_started: '#fde68a', phase_completed: '#fde68a',
    delivered: '#6ee7b7', cancelled: '#cbd5e1', rejected: '#fca5a5',
    sla_breached: '#fca5a5', note: '#94a3b8',
  };
  return c[kind] || '#64748b';
};

const selectStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.8)', color: '#e2e8f0',
  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px',
  padding: '4px 8px', fontSize: '0.85rem',
};
const refreshBtn: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.3)', borderRadius: '6px',
  padding: '6px 14px', cursor: 'pointer', fontSize: '0.85rem', marginTop: '14px',
};
const detailBtn: React.CSSProperties = {
  background: 'rgba(99, 102, 241, 0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99, 102, 241, 0.25)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem', marginRight: '6px',
};
const cancelBtn: React.CSSProperties = {
  background: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1',
  border: '1px solid rgba(100, 116, 139, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem',
  marginRight: '6px',
};
const rejectBtn: React.CSSProperties = {
  background: 'rgba(239, 68, 68, 0.15)', color: '#fca5a5',
  border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.75rem',
};
const smallBtn: React.CSSProperties = {
  background: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1',
  border: '1px solid rgba(100, 116, 139, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.78rem',
};
const preStyle: React.CSSProperties = {
  background: 'rgba(2, 6, 23, 0.6)', color: '#cbd5e1',
  padding: '10px 12px', borderRadius: '6px', fontSize: '0.75rem',
  overflowX: 'auto', margin: 0, maxHeight: '280px',
};

export default CustomerPortal;
