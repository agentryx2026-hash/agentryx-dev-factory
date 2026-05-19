import React from 'react';

/**
 * Notifications — Courier event-history viewer (Phase 10-A / Phase 19-B D230).
 *
 * PR-B placeholder. Renders a static summary of what events the factory
 * IS currently dispatching. PR-D will add an admin endpoint exposing
 * `courier.getHistory()` + the fake backend's `_getSent()` log and wire
 * this view to it so the founder can see every notification as it fires.
 *
 * Currently the factory dispatches these `customer.*` Courier events
 * (each routed to `stdout` channel for v0.0.1; per-customer prefs is
 * a 19-C ship):
 */

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

const eventTypes: { type: string; severity: string; trigger: string; ship: string }[] = [
  { type: 'customer.submission_received',  severity: 'info', trigger: 'POST /api/customer-portal/submit succeeds + auto-enqueue', ship: 'D231 (live)' },
  { type: 'customer.submission_cancelled', severity: 'info', trigger: 'POST /api/customer-portal/submissions/:id/cancel succeeds', ship: 'D231 (live)' },
  { type: 'customer.sla_breached',         severity: 'warn', trigger: 'SLA breach scanner detects past-target submission', ship: 'D228 + D230 (live)' },
  { type: 'customer.submission_accepted',  severity: 'info', trigger: 'project_intake handler walks submitted → accepted', ship: 'D232 — pending' },
  { type: 'customer.submission_delivered', severity: 'info', trigger: 'back-feed wrapper transitions in_progress → delivered', ship: 'D232 — pending' },
  { type: 'customer.submission_rejected',  severity: 'warn', trigger: 'admin reject (manual)', ship: 'D233 — pending' },
];

const Notifications: React.FC = () => {
  return (
    <div style={{ padding: '24px 32px', color: '#e2e8f0' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '1.6rem', margin: 0, color: '#f1f5f9' }}>Notifications</h1>
        <p style={{ color: '#94a3b8', marginTop: '4px' }}>
          Courier events the factory dispatches when customer-facing things happen.
          v0.0.1 routes everything to the <code>stdout</code> channel (founder log);
          per-customer email/Slack targets arrive with the 19-C prefs ship.
        </p>
      </div>

      <div style={sectionStyle}>
        <div style={labelStyle}>Event taxonomy</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <th style={{ padding: '8px 12px' }}>Event type</th>
              <th style={{ padding: '8px 12px' }}>Severity</th>
              <th style={{ padding: '8px 12px' }}>Fires when</th>
              <th style={{ padding: '8px 12px' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {eventTypes.map((e) => (
              <tr key={e.type} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <td style={{ padding: '8px 12px', fontFamily: 'monospace', color: '#10b981' }}>{e.type}</td>
                <td style={{ padding: '8px 12px' }}>
                  <span style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    background: e.severity === 'warn' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                    color: e.severity === 'warn' ? '#fde68a' : '#a5b4fc',
                    fontSize: '0.75rem',
                  }}>
                    {e.severity}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{e.trigger}</td>
                <td style={{ padding: '8px 12px', color: e.ship.includes('live') ? '#10b981' : '#64748b', fontSize: '0.8rem' }}>{e.ship}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ ...sectionStyle, borderStyle: 'dashed', background: 'rgba(15, 23, 42, 0.3)' }}>
        <div style={labelStyle}>Coming in next ship (PR D)</div>
        <ul style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.7, marginTop: '8px' }}>
          <li>Live event-history feed (every Courier dispatch as it lands)</li>
          <li>Filter by event type / severity / customer / time window</li>
          <li>Click into an event → full payload (title, body, meta) + delivery result per channel</li>
          <li>Re-dispatch button (useful when Courier backend was down)</li>
        </ul>
        <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '12px', fontStyle: 'italic' }}>
          Substrate (notifier + Courier event taxonomy + 6 routing rules) ships live; needs an
          admin endpoint exposing <code>courier.getHistory()</code> + this React view consumes it.
        </p>
      </div>
    </div>
  );
};

export default Notifications;
