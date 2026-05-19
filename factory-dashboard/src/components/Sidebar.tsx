import React, { useState, useEffect } from 'react';

type Page =
  | 'pre-dev' | 'factory' | 'post-dev' | 'architect' | 'replay'
  | 'customer-portal' | 'notifications'
  | 'analytics' | 'skills' | 'cost-panel'
  | 'system' | 'settings' | 'admin-keys' | 'services-health'
  | 'console-n8n' | 'console-langfuse' | 'console-paperclip' | 'console-litellm';

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
}

// Grouped IA — 5 intent buckets. Sections collapse the now-large feature
// set so the scan path is short.
type NavSection = {
  label: string;
  hint?: string;
  items: { page: Page; icon: string; label: string; badge?: string }[];
};

const navSections: NavSection[] = [
  {
    label: 'Factory Floor',
    hint:  'The dev pipeline you drive',
    items: [
      { page: 'pre-dev',   icon: '📥', label: '1. Intake (Pre-Dev)' },
      { page: 'factory',   icon: '🏭', label: '2. Live Dev Floor' },
      { page: 'post-dev',  icon: '🚀', label: '3. Releases (Ship)' },
      { page: 'architect', icon: '👑', label: '4. Master Architect' },
      { page: 'replay',    icon: '🎬', label: '5. Replay (debug)' },
    ],
  },
  {
    label: 'Customer View',
    hint:  'Submissions your customers drive',
    items: [
      { page: 'customer-portal', icon: '👥', label: 'Customer Portal' },
      { page: 'notifications',   icon: '📨', label: 'Notifications' },
    ],
  },
  {
    label: 'Insights',
    hint:  'What the factory has produced',
    items: [
      { page: 'analytics',  icon: '📈', label: 'Analytics & Insights' },
      { page: 'skills',     icon: '🧠', label: 'Memory Layer' },
      { page: 'cost-panel', icon: '💰', label: 'Cost Panel' },
    ],
  },
  {
    label: 'Embedded Consoles',
    hint:  'Each tool\'s own UI, inside Dev-Hub',
    items: [
      { page: 'console-n8n',       icon: '🔗', label: 'n8n Workflows',  badge: 'NEW' },
      { page: 'console-langfuse',  icon: '🔍', label: 'Langfuse Traces', badge: 'NEW' },
      { page: 'console-paperclip', icon: '📎', label: 'Paperclip',       badge: 'NEW' },
      { page: 'console-litellm',   icon: '🧮', label: 'LiteLLM Admin',   badge: 'NEW' },
    ],
  },
  {
    label: 'Ops',
    hint:  'Operate + configure the system',
    items: [
      { page: 'services-health', icon: '💓', label: 'Services Health', badge: 'NEW' },
      { page: 'system',          icon: '📊', label: 'System Resources' },
      { page: 'settings',        icon: '⚙️', label: 'Admin · Configuration' },
      { page: 'admin-keys',      icon: '🔑', label: 'API Keys' },
    ],
  },
];

const sectionHeaderStyle: React.CSSProperties = {
  margin: '1rem 16px 0.25rem 16px',
  padding: 0,
};
const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  fontWeight: 600,
};
const sectionHintStyle: React.CSSProperties = {
  fontSize: '0.62rem',
  color: '#475569',
  marginTop: '2px',
  fontStyle: 'italic',
};
const badgeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: '0.55rem',
  background: '#10b981',
  color: '#0f172a',
  padding: '1px 6px',
  borderRadius: '999px',
  fontWeight: 700,
  letterSpacing: '0.5px',
};

const Sidebar: React.FC<SidebarProps> = ({ activePage, setActivePage }) => {
  const [latestLogs, setLatestLogs] = useState<any[]>([]);
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    const sse = new EventSource('/telemetry/telemetry/stream');
    sse.onopen = () => setIsLive(true);
    sse.onerror = () => setIsLive(false);
    sse.onmessage = (e) => {
        try {
            const state = JSON.parse(e.data);
            if (state.logs && state.logs.length > 0) {
                setLatestLogs(state.logs.slice(0, 3));
            }
        } catch (err) {}
    };
    return () => sse.close();
  }, []);

  return (
    <aside className="sidebar" id="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div className="sidebar-brand" style={{ flexShrink: 0 }}>
        <div className="sidebar-brand-inner">
          <div className="brand-icon">AX</div>
          <div className="brand-text">
            <span className="brand-name">Agentryx Dev-Hub</span>
            <span className="brand-tagline">Autonomous AI Factory</span>
          </div>
        </div>
      </div>

      <nav
        className="sidebar-nav"
        style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'thin' }}
      >
        {navSections.map((section) => (
          <React.Fragment key={section.label}>
            <div style={sectionHeaderStyle}>
              <div style={sectionLabelStyle}>{section.label}</div>
              {section.hint && <div style={sectionHintStyle}>{section.hint}</div>}
            </div>
            {section.items.map((item) => (
              <div
                key={item.page}
                id={`nav-${item.page}`}
                className={`nav-item ${activePage === item.page ? 'active' : ''}`}
                onClick={() => setActivePage(item.page)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && setActivePage(item.page)}
                style={{ display: 'flex', alignItems: 'center' }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label">{item.label}</span>
                {item.badge && <span style={badgeStyle}>{item.badge}</span>}
              </div>
            ))}
          </React.Fragment>
        ))}

        {/* External Links — now slimmer because the consoles with real UIs
            got promoted to the Embedded Consoles section above. This
            section is for things you OPEN ELSEWHERE (no usable UI to embed,
            or a dedicated separate domain). */}
        <div style={sectionHeaderStyle}>
          <div style={sectionLabelStyle}>External Links</div>
          <div style={sectionHintStyle}>Hosted dashboards + repos</div>
        </div>
        {[
          { href: 'https://claw-code.agentryx.dev/',                       icon: '🦞', label: 'Claw Code (terminal)' },
          { href: 'https://openrouter.ai/settings/credits',                icon: '🛰️', label: 'OpenRouter (billing)' },
          { href: 'https://console.anthropic.com/',                        icon: '🤖', label: 'Anthropic Console' },
          { href: 'https://github.com/agentryx2026-hash/agentryx-factory', icon: '🐙', label: 'GitHub Repo' },
          { href: 'https://console.cloud.google.com/compute',              icon: '☁️', label: 'GCP Console' },
        ].map(tool => (
          <a
            key={tool.href}
            href={tool.href}
            target="_blank"
            rel="noreferrer"
            className="nav-item"
            style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center' }}
          >
            <span className="nav-icon">{tool.icon}</span>
            <span className="nav-label">{tool.label}</span>
          </a>
        ))}
      </nav>

      {/* Mini Activity Trail — pinned */}
      <div style={{ flexShrink: 0, margin: '0 16px 16px 16px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Live Trace</span>
            <span className={`status-dot ${isLive ? 'active' : ''}`} style={{ background: isLive ? '#10b981' : '#ef4444', height: '6px', width: '6px', borderRadius: '50%', boxShadow: isLive ? '0 0 5px #10b981' : 'none' }}></span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', height: '100px', overflow: 'hidden', fontFamily: 'monospace' }}>
            {latestLogs.map((log, i) => (
                <div key={i} style={{ display: 'flex', gap: '6px' }}>
                    <span style={{ fontSize: '0.65rem', color: '#10b981', opacity: 1 - (i * 0.3), minWidth: '40px' }}>{log.time}</span>
                    <span style={{ fontSize: '0.65rem', color: i === 0 ? '#4ade80' : '#10b981', opacity: 1 - (i * 0.3), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.message}</span>
                </div>
            ))}
            {latestLogs.length === 0 && (
                <span style={{ fontSize: '0.65rem', color: '#10b981', fontStyle: 'italic' }}>Awaiting signals...</span>
            )}
        </div>
      </div>

      <div className="sidebar-footer" style={{ flexShrink: 0 }}>
        <div className="sidebar-status">
          <span className="status-dot" style={{ background: isLive ? '#10b981' : '#fbbf24' }} />
          <span>{isLive ? 'System Live & Polling' : 'Connecting...'}</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
