import React, { useEffect, useState } from 'react';

/**
 * Customer Portal — admin view of customer submissions (Phase 19-B).
 *
 * This is the PR-B placeholder. It already lists all customers via the
 * admin endpoint (which exists), so the founder sees something real
 * immediately. The submissions list / status detail / cancel / SLA
 * sub-views land in PR-C once the matching admin HTTP endpoints exist.
 *
 * What this surface covers (when fully built):
 *   - All customers and their submissions across the portal
 *   - Per-submission status, timeline, SLA, delivered-by-job linkage
 *   - Admin cancel + reject with reason
 *   - Filter by status / tier / breach state
 */

interface Customer {
  id: string;
  email: string;
  display_name: string;
  tier: string;
  created_at: string;
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

const CustomerPortal: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/telemetry/customer-portal/admin/customers');
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        setCustomers(Array.isArray(data?.customers) ? data.customers : []);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Customer Portal</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Submissions your customers drive through the public <code>/api/customer-portal/*</code> surface.
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Registered customers</div>
        {loading && <div style={{ color: '#94a3b8' }}>Loading…</div>}
        {err && (
          <div style={{ color: '#f87171', fontSize: '0.85rem' }}>
            Failed to load: {err}
          </div>
        )}
        {!loading && !err && customers.length === 0 && (
          <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>
            No customers yet. Register one via <code>POST /api/customer-portal/admin/customers</code>.
          </div>
        )}
        {!loading && customers.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                <th style={{ padding: '8px 12px' }}>ID</th>
                <th style={{ padding: '8px 12px' }}>Email</th>
                <th style={{ padding: '8px 12px' }}>Display name</th>
                <th style={{ padding: '8px 12px' }}>Tier</th>
                <th style={{ padding: '8px 12px' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#10b981' }}>{c.id}</td>
                  <td style={{ padding: '8px 12px' }}>{c.email}</td>
                  <td style={{ padding: '8px 12px' }}>{c.display_name}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(99, 102, 241, 0.2)', color: '#a5b4fc', fontSize: '0.75rem' }}>{c.tier}</span>
                  </td>
                  <td style={{ padding: '8px 12px', color: '#94a3b8', fontSize: '0.8rem' }}>{new Date(c.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ ...sectionStyle, borderStyle: 'dashed', background: 'rgba(15, 23, 42, 0.3)' }}>
        <div style={labelStyle}>Coming in next ship (PR C)</div>
        <ul style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.7, marginTop: '8px' }}>
          <li>List of all submissions across all customers (status, tier, SLA, breach state)</li>
          <li>Per-submission detail: timeline, downstream pre_dev job link, delivered_by_job_id, consumed cost</li>
          <li>Admin actions: cancel (with reason), reject (with reason)</li>
          <li>SLA breach panel (driven by the running SLA scanner — D228+D229+D230)</li>
        </ul>
        <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '12px', fontStyle: 'italic' }}>
          Substrate (D224 / D225 / D227 / D228 / D229 / D230 / D231) is shipped + live-verified
          end-to-end on real LLM ($1.59 customer-flow E2E cycle 2026-05-18).
          This UI surface just needs the admin-side query endpoints + tab content to render it.
        </p>
      </div>
    </div>
  );
};

export default CustomerPortal;
