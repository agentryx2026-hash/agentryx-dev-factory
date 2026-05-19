import React, { useState } from 'react';

/**
 * EmbeddedConsole — generic iframe wrapper for external tools' web
 * consoles (n8n, Langfuse, Paperclip, LiteLLM). One component, configured
 * per-tab in App.tsx so each gets its own sidebar entry but they all
 * share this UI shell.
 *
 * Why iframe instead of in-app integration: each tool is its own complex
 * SPA we don't control. Iframing them inside Dev-Hub keeps the founder's
 * context (sidebar nav + Live Trace + brand) on one page without having
 * to fork or rebuild any tool's UI.
 *
 * Iframe gotchas handled:
 *   - X-Frame-Options / CSP frame-ancestors: if the tool refuses iframe,
 *     the iframe loads blank. The component shows an inline notice + a
 *     fallback "Open in new tab" link so the founder is never stuck.
 *   - Same-origin: when both Dev-Hub and the tool are served from
 *     dev-hub.agentryx.dev via nginx proxy, the iframe is same-origin and
 *     cookies/auth work. For cross-origin tools (e.g. external URLs),
 *     auth context is the tool's own.
 *   - Sizing: takes the full main-content area minus a thin header strip.
 */

interface EmbeddedConsoleProps {
  title: string;
  description?: string;
  url: string;
  /** Show a notice if iframe might be blocked (e.g. known-strict CSP services). */
  warning?: string;
}

const EmbeddedConsole: React.FC<EmbeddedConsoleProps> = ({ title, description, url, warning }) => {
  const [iframeKey, setIframeKey] = useState(0);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', color: '#e2e8f0' }}>
      <div style={{
        padding: '12px 24px',
        background: 'rgba(15, 23, 42, 0.6)',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#f1f5f9' }}>{title}</h2>
          {description && <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginTop: '2px' }}>{description}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {loadedAt && (
            <span style={{ color: '#64748b', fontSize: '0.72rem' }}>Loaded {loadedAt.toLocaleTimeString()}</span>
          )}
          <button onClick={() => { setIframeKey(k => k + 1); setLoadedAt(null); }} style={iconBtn} title="Reload iframe">↻</button>
          <a href={url} target="_blank" rel="noreferrer" style={openBtn}>Open in new tab ↗</a>
        </div>
      </div>

      {warning && (
        <div style={{
          padding: '8px 24px',
          background: 'rgba(251, 191, 36, 0.1)',
          borderBottom: '1px solid rgba(251, 191, 36, 0.2)',
          color: '#fde68a',
          fontSize: '0.78rem',
          flexShrink: 0,
        }}>
          ⚠ {warning}
        </div>
      )}

      <div style={{ flexGrow: 1, minHeight: 0, background: '#0b1120', position: 'relative' }}>
        <iframe
          key={iframeKey}
          src={url}
          title={title}
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
          onLoad={() => setLoadedAt(new Date())}
          // Allow common needs without opening clipboard / camera by default.
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-downloads allow-modals"
          referrerPolicy="no-referrer-when-downgrade"
        />
      </div>
    </div>
  );
};

const iconBtn: React.CSSProperties = {
  background: 'rgba(100, 116, 139, 0.2)', color: '#cbd5e1',
  border: '1px solid rgba(100, 116, 139, 0.3)', borderRadius: '4px',
  padding: '3px 10px', cursor: 'pointer', fontSize: '0.85rem',
};
const openBtn: React.CSSProperties = {
  display: 'inline-block', padding: '4px 12px', borderRadius: '4px',
  background: 'rgba(99,102,241,0.15)', color: '#a5b4fc',
  border: '1px solid rgba(99,102,241,0.25)', fontSize: '0.78rem',
  textDecoration: 'none',
};

export default EmbeddedConsole;
