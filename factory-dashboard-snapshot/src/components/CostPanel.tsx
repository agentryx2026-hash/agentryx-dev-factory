// Phase 2G — Cost panel. Read-only view of llm_calls aggregates.
// Writes (budget cap editing) land in Phase 12 full B7 admin module.

import { useEffect, useState } from 'react';

interface Summary {
  today_usd: number;
  week_usd: number;
  month_usd: number;
  calls_today: string;
  budget_refusals_today: string;
}

interface ProjectDayRow {
  project_id: string;
  day: string;
  calls: string;
  cost_usd: number;
  input_tokens: string;
  output_tokens: string;
  avg_latency_ms: number | null;
  errors: string;
}

interface ModelRow {
  model: string;
  calls: string;
  cost_usd: number;
  input_tokens: string;
  output_tokens: string;
}

const ADMIN_BASE = '/admin/api/admin';

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text() || res.statusText}`);
  return res.json();
}

function fmtUsd(n: number, digits = 4): string {
  return '$' + n.toFixed(digits);
}
function fmtInt(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return '—';
  return Number(s).toLocaleString();
}

const CostPanel: React.FC = () => {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [projectRows, setProjectRows] = useState<ProjectDayRow[]>([]);
  const [modelRows, setModelRows] = useState<ModelRow[]>([]);
  const [includeCompare, setIncludeCompare] = useState(false);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const qs = includeCompare ? '&include_compare=true' : '';
      const [s, p, m] = await Promise.all([
        api<{ summary: Summary }>(`/cost/summary?x=1${qs}`),
        api<{ rows: ProjectDayRow[] }>(`/cost/by-project-day?days=${days}${qs}`),
        api<{ rows: ModelRow[] }>(`/cost/by-model-today?x=1${qs}`),
      ]);
      setSummary(s.summary);
      setProjectRows(p.rows);
      setModelRows(m.rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [includeCompare, days]);

  const maxProjectSpend = projectRows.length > 0 ? Math.max(...projectRows.map(r => r.cost_usd)) : 0;

  return (
    <div style={{ padding: '2rem', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
        <div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.25rem' }}>💰 Cost Panel</h1>
          <p style={{ color: '#94a3b8', margin: 0 }}>
            LLM spend tracked per call in <code>llm_calls</code>. Hard caps are set in <code>configs/llm-routing.json</code>;
            changes land in Phase 12.
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={loading}
          style={{ padding: '0.5rem 1rem', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 4, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '1rem', background: '#7f1d1d', borderRadius: 8, marginBottom: '1rem' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          <Card label="Today"           value={fmtUsd(summary.today_usd)} />
          <Card label="This Week"       value={fmtUsd(summary.week_usd)} />
          <Card label="This Month"      value={fmtUsd(summary.month_usd)} />
          <Card label="Calls Today"     value={fmtInt(summary.calls_today)} />
          <Card label="Budget Refusals" value={fmtInt(summary.budget_refusals_today)} tone={Number(summary.budget_refusals_today) > 0 ? 'warn' : 'neutral'} />
        </div>
      )}

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
        <label style={{ display: 'flex', gap: '0.5rem', cursor: 'pointer' }}>
          <input type="checkbox" checked={includeCompare} onChange={(e) => setIncludeCompare(e.target.checked)} />
          <span style={{ color: '#94a3b8' }}>Include <code>__compare__</code> evaluation runs</span>
        </label>
        <label style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto', color: '#94a3b8' }}>
          Days:
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ background: '#1e293b', color: '#fff', border: '1px solid #334155', padding: '0.25rem 0.5rem' }}>
            <option value={1}>1</option>
            <option value={7}>7</option>
            <option value={30}>30</option>
            <option value={90}>90</option>
          </select>
        </label>
      </div>

      <h2 style={{ fontSize: '1.2rem', marginTop: '2rem', marginBottom: '0.5rem' }}>Per-project × day</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Project</th>
            <th style={th}>Day</th>
            <th style={{ ...th, textAlign: 'right' }}>Cost</th>
            <th style={{ ...th, textAlign: 'right' }}>Calls</th>
            <th style={{ ...th, textAlign: 'right' }}>Errors</th>
            <th style={{ ...th, textAlign: 'right' }}>Avg latency</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {projectRows.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ padding: '1rem', color: '#64748b', textAlign: 'center' }}>No data in selected window.</td></tr>
          )}
          {projectRows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #334155' }}>
              <td style={td}><code>{r.project_id}</code></td>
              <td style={td}>{r.day.slice(0, 10)}</td>
              <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtUsd(r.cost_usd, 6)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmtInt(r.calls)}</td>
              <td style={{ ...td, textAlign: 'right', color: Number(r.errors) > 0 ? '#fca5a5' : '#64748b' }}>{fmtInt(r.errors)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#94a3b8' }}>{r.avg_latency_ms ? `${r.avg_latency_ms}ms` : '—'}</td>
              <td style={{ ...td, width: '25%' }}>
                <div style={{ background: '#334155', borderRadius: 4, height: 8 }}>
                  <div style={{ width: `${Math.max(2, (r.cost_usd / maxProjectSpend) * 100)}%`, background: '#16a34a', height: 8, borderRadius: 4 }} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: '1.2rem', marginTop: '2rem', marginBottom: '0.5rem' }}>Per-model today</h2>
      <table style={tableStyle}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Model</th>
            <th style={{ ...th, textAlign: 'right' }}>Cost</th>
            <th style={{ ...th, textAlign: 'right' }}>Calls</th>
            <th style={{ ...th, textAlign: 'right' }}>Input tok</th>
            <th style={{ ...th, textAlign: 'right' }}>Output tok</th>
          </tr>
        </thead>
        <tbody>
          {modelRows.length === 0 && !loading && (
            <tr><td colSpan={5} style={{ padding: '1rem', color: '#64748b', textAlign: 'center' }}>No successful calls today.</td></tr>
          )}
          {modelRows.map((r, i) => (
            <tr key={i} style={{ borderTop: '1px solid #334155' }}>
              <td style={td}><code style={{ fontSize: '0.85rem' }}>{r.model}</code></td>
              <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{fmtUsd(r.cost_usd, 6)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{fmtInt(r.calls)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#94a3b8' }}>{fmtInt(r.input_tokens)}</td>
              <td style={{ ...td, textAlign: 'right', color: '#94a3b8' }}>{fmtInt(r.output_tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', background: '#0f172a', borderRadius: 8, overflow: 'hidden' };
const trHead: React.CSSProperties = { background: '#1e293b', textAlign: 'left' };
const th: React.CSSProperties = { padding: '0.6rem 1rem', fontWeight: 600, fontSize: '0.9rem', color: '#cbd5e1' };
const td: React.CSSProperties = { padding: '0.6rem 1rem' };

const Card: React.FC<{ label: string; value: string; tone?: 'warn' | 'neutral' }> = ({ label, value, tone }) => (
  <div style={{ background: '#0f172a', padding: '1rem', borderRadius: 8, borderLeft: `4px solid ${tone === 'warn' ? '#f97316' : '#16a34a'}` }}>
    <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '0.25rem' }}>{label}</div>
    <div style={{ fontSize: '1.5rem', fontWeight: 600, fontFamily: 'monospace' }}>{value}</div>
  </div>
);

export default CostPanel;
