import React, { useState, useEffect } from 'react';

type Page = 'pre-dev' | 'factory' | 'post-dev' | 'analytics' | 'settings' | 'skills' | 'system';

interface SidebarProps {
  activePage: Page;
  setActivePage: (page: Page) => void;
}

const navItems: { page: Page; icon: string; label: string }[] = [
  { page: 'pre-dev', icon: '📥', label: '1. Intake (Pre-Dev)' },
  { page: 'factory', icon: '🏭', label: '2. Live Dev Floor' },
  { page: 'post-dev', icon: '🚀', label: '3. Releases (Ship)' },
  { page: 'analytics', icon: '📈', label: 'Analytics & Insights' },
  { page: 'skills', icon: '🧠', label: 'Skill Memory' },
  { page: 'system', icon: '📊', label: 'System Resources' },
  { page: 'settings', icon: '⚙️', label: 'Configuration' },
];

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
                setLatestLogs(state.logs.slice(0, 3)); // Get newest 3 logs which are at the start
            }
        } catch (err) {}
    };
    return () => sse.close();
  }, []);

  return (
    <aside className="sidebar" id="sidebar-nav" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-inner">
          <div className="brand-icon">AX</div>
          <div className="brand-text">
            <span className="brand-name">Agentryx Dev-Hub</span>
            <span className="brand-tagline">Autonomous AI Factory</span>
          </div>
        </div>
      </div>

      <nav className="sidebar-nav" style={{ flexGrow: 1 }}>
        {navItems.map((item) => (
          <div
            key={item.page}
            id={`nav-${item.page}`}
            className={`nav-item ${activePage === item.page ? 'active' : ''}`}
            onClick={() => setActivePage(item.page)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && setActivePage(item.page)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
          </div>
        ))}
      </nav>

      {/* Mini Activity Trail */}
      <div style={{ margin: '0 16px 16px 16px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
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

      <div className="sidebar-footer">
        <div className="sidebar-status">
          <span className="status-dot" style={{ background: isLive ? '#10b981' : '#fbbf24' }} />
          <span>{isLive ? 'System Live & Polling' : 'Connecting...'}</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
