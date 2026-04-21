// Phase 2.5-C — API Key Console UI.
//
// Talks to the factory-admin service via /admin/api/admin/keys/* (nginx-proxied,
// HTTP basic auth gated). Browser will pop the auth dialog on first fetch if
// the user hasn't authenticated this session.

import { useEffect, useState } from 'react';

interface KeyRow {
  provider: string;
  label: string;
  docs_url?: string;
  key_prefix_hint?: string | null;
  expected_length?: [number, number];
  masked: string | null;
  length: number | null;
  enabled: boolean;
  last_used_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

const ADMIN_BASE = '/admin/api/admin';

async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`);
  }
  return res.json();
}

function fmtRelative(ts: string | null): string {
  if (!ts) return 'never';
  const ms = Date.now() - new Date(ts).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const AdminKeys: React.FC = () => {
  const [rows, setRows] = useState<KeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ provider: string; label: string } | null>(null);
  const [formKey, setFormKey] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [testStatus, setTestStatus] = useState<Record<string, string>>({});

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { keys } = await api<{ keys: KeyRow[] }>('/keys');
      setRows(keys);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSave() {
    if (!editing) return;
    if (!formKey || formKey.length < 8) {
      setFormError('Key looks too short');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await api(`/keys/${editing.provider}`, {
        method: 'POST',
        body: JSON.stringify({ key: formKey }),
      });
      setEditing(null);
      setFormKey('');
      await refresh();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(provider: string, enabled: boolean) {
    try {
      await api(`/keys/${provider}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      await refresh();
    } catch (e: any) {
      alert(`Toggle failed: ${e.message}`);
    }
  }

  async function handleDelete(provider: string) {
    if (!confirm(`Delete the ${provider} key? The encrypted value is removed; the audit log entry remains.`)) return;
    try {
      await api(`/keys/${provider}`, { method: 'DELETE' });
      await refresh();
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  }

  async function handleTest(provider: string) {
    setTestStatus((s) => ({ ...s, [provider]: 'testing…' }));
    try {
      const r = await api<{ ok: boolean; http_status?: number; latency_ms?: number; error?: string; skipped?: boolean }>(`/keys/${provider}/test`, { method: 'POST' });
      const msg = r.skipped ? 'no test endpoint configured'
        : r.ok ? `✅ ${r.http_status} (${r.latency_ms}ms)`
        : `❌ ${r.http_status || ''} ${r.error || ''}`;
      setTestStatus((s) => ({ ...s, [provider]: msg }));
    } catch (e: any) {
      setTestStatus((s) => ({ ...s, [provider]: `error: ${e.message}` }));
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>🔑 API Keys</h1>
        <p style={{ color: '#94a3b8', margin: 0 }}>
          Encrypted at rest (AES-256-GCM). Keys are masked in the UI; full values never leave the database.
          Changes are audit-logged. Toggle <em>off</em> to disable a provider without losing the key.
        </p>
      </div>

      {loading && <p>Loading…</p>}
      {error && (
        <div style={{ padding: '1rem', background: '#7f1d1d', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
          {error.includes('401') && <p>You may need to authenticate via HTTP Basic.</p>}
        </div>
      )}

      {!loading && !error && (
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#0f172a', borderRadius: 8, overflow: 'hidden' }}>
          <thead>
            <tr style={{ background: '#1e293b', textAlign: 'left' }}>
              <th style={{ padding: '0.75rem 1rem' }}>Provider</th>
              <th style={{ padding: '0.75rem 1rem' }}>Key (masked)</th>
              <th style={{ padding: '0.75rem 1rem' }}>Enabled</th>
              <th style={{ padding: '0.75rem 1rem' }}>Last Used</th>
              <th style={{ padding: '0.75rem 1rem' }}>Test</th>
              <th style={{ padding: '0.75rem 1rem' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.provider} style={{ borderTop: '1px solid #334155' }}>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <div style={{ fontWeight: 600 }}>{r.label}</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    {r.provider}
                    {r.docs_url && <> · <a href={r.docs_url} target="_blank" rel="noreferrer" style={{ color: '#60a5fa' }}>docs ↗</a></>}
                  </div>
                </td>
                <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace' }}>
                  {r.masked || <span style={{ color: '#64748b', fontStyle: 'italic' }}>not set</span>}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  {r.masked ? (
                    <button
                      onClick={() => handleToggle(r.provider, !r.enabled)}
                      style={{ padding: '0.25rem 0.75rem', background: r.enabled ? '#16a34a' : '#475569', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      {r.enabled ? '✅ ON' : '⚪ OFF'}
                    </button>
                  ) : (
                    <span style={{ color: '#64748b' }}>—</span>
                  )}
                </td>
                <td style={{ padding: '0.75rem 1rem', color: '#94a3b8' }}>
                  {fmtRelative(r.last_used_at)}
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  {r.masked && (
                    <button onClick={() => handleTest(r.provider)} style={{ padding: '0.25rem 0.5rem', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
                      Test
                    </button>
                  )}
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>{testStatus[r.provider]}</div>
                </td>
                <td style={{ padding: '0.75rem 1rem' }}>
                  <button onClick={() => { setEditing({ provider: r.provider, label: r.label }); setFormKey(''); setFormError(null); }} style={{ padding: '0.25rem 0.5rem', marginRight: '0.5rem', background: '#0284c7', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
                    {r.masked ? 'Edit' : 'Add'}
                  </button>
                  {r.masked && (
                    <button onClick={() => handleDelete(r.provider)} style={{ padding: '0.25rem 0.5rem', background: '#7f1d1d', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: '0.85rem' }}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={() => setEditing(null)}>
          <div style={{ background: '#0f172a', padding: '2rem', borderRadius: 8, width: 520, maxWidth: '90vw' }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Set {editing.label} API key</h2>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>
              Paste the API key below. It will be encrypted with AES-256-GCM and stored in the database.
              The plaintext value is never logged or returned.
            </p>
            <input
              type="password"
              autoFocus
              autoComplete="off"
              value={formKey}
              onChange={(e) => setFormKey(e.target.value)}
              placeholder="sk-..."
              style={{ width: '100%', padding: '0.75rem', background: '#1e293b', border: '1px solid #334155', borderRadius: 4, color: '#fff', fontFamily: 'monospace', fontSize: '0.95rem', marginBottom: '0.5rem' }}
            />
            {formError && <p style={{ color: '#fca5a5', margin: '0.5rem 0' }}>⚠️ {formError}</p>}
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button onClick={() => setEditing(null)} disabled={submitting} style={{ padding: '0.5rem 1rem', background: '#475569', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={submitting || !formKey} style={{ padding: '0.5rem 1rem', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 4, cursor: submitting ? 'wait' : 'pointer' }}>
                {submitting ? 'Saving…' : 'Save key'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminKeys;
