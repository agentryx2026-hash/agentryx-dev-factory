import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/* ═══════════════════════════════════════════════════════════
   FACTORY FLOOR — The Live Pipeline Visualization
   ═══════════════════════════════════════════════════════════ */

interface Agent {
  id: string;
  name: string;
  role: string;
  model: string;
  status: 'idle' | 'working' | 'online';
  cssClass: string;
}

interface Room {
  title: string;
  icon: string;
  agents: Agent[];
}

// Simulated agent data — will be replaced by WebSocket state in Sprint 7
const INITIAL_AGENTS: Agent[] = [
  { id: 'jane', name: 'Jane', role: 'PM / Triage', model: 'gemini-2.5-flash', status: 'idle', cssClass: 'jane' },
  { id: 'spock', name: 'Spock', role: 'Auto-Research', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'spock' },
  { id: 'torres', name: 'Torres', role: 'Junior Dev', model: 'gemini-3.1-pro', status: 'working', cssClass: 'torres' },
  { id: 'data', name: 'Data', role: 'Sr. Architect', model: 'gemini-3.1-pro', status: 'idle', cssClass: 'data' },
  { id: 'tuvok', name: 'Tuvok', role: 'QA Reviewer', model: 'gemini-3.1-pro', status: 'online', cssClass: 'tuvok' },
  { id: 'obrien', name: "O'Brien", role: 'SRE / Deploy', model: 'gemini-2.5-flash', status: 'online', cssClass: 'obrien' },
];

// Simulated log entries
const SIMULATED_LOGS = [
  { time: '22:38', agent: 'jane', agentLabel: 'Jane', message: 'Parsed incoming ticket #187 — routing to Torres.' },
  { time: '22:37', agent: 'torres', agentLabel: 'Torres', message: 'Building NavBar component... running npm test.' },
  { time: '22:35', agent: 'spock', agentLabel: 'Spock', message: 'Research complete: React 19 Server Components recommended.' },
  { time: '22:33', agent: 'tuvok', agentLabel: 'Tuvok', message: 'Approved PR #84. No security regressions detected.' },
  { time: '22:30', agent: 'obrien', agentLabel: "O'Brien", message: 'Deployed v2.3.1 to staging. Waiting for CI.' },
  { time: '22:28', agent: 'data', agentLabel: 'Data', message: 'Resolved database migration conflict on users table.' },
  { time: '22:25', agent: 'jane', agentLabel: 'Jane', message: 'Morning triage complete. 3 tickets queued.' },
];

// Infrastructure services
const INFRA_SERVICES = [
  { name: 'Redis 7', detail: ':6379 • Message Queue', status: 'healthy' as const },
  { name: 'PostgreSQL 16', detail: ':5432 • Agent Memory', status: 'healthy' as const },
  { name: 'ChromaDB', detail: ':8000 • Vector / RAG', status: 'healthy' as const },
  { name: 'n8n', detail: ':5678 • Webhooks', status: 'healthy' as const },
  { name: 'LangFuse', detail: ':3000 • Tracing', status: 'healthy' as const },
  { name: 'Vite Dashboard', detail: ':5173 • This UI', status: 'healthy' as const },
];

const FactoryFloor: React.FC = () => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isTerminalExpanded, setIsTerminalExpanded] = useState(false);

  const [liveAgents, setLiveAgents] = useState(INITIAL_AGENTS.map(a => ({...a, room: a.role === 'PM / Triage' ? 0 : a.role === 'Auto-Research' ? 1 : a.role === 'Junior Dev' || a.role === 'Sr. Architect' ? 2 : a.role === 'QA Reviewer' ? 3 : a.role === 'SRE / Deploy' ? 5 : 1})));
  const [liveLogs, setLiveLogs] = useState(SIMULATED_LOGS);
  const [workItems, setWorkItems] = useState<{id: string, name: string, room: number, color: string}[]>([]);
  const [completedItems, setCompletedItems] = useState<any[]>([]);
  const [showCompletedModal, setShowCompletedModal] = useState(false);
  const [sysMetrics, setSysMetrics] = useState<{cpu: number, ram: number, disk: number, tokens: string} | null>(null);

  const [workspaceFiles, setWorkspaceFiles] = useState<any[]>([]);
  const [selectedFile, setSelectedFile] = useState<any>(null);
  const [runOutput, setRunOutput] = useState('');

  // Recursive file tree renderer
  const renderFileTree = (tree: any[], projectName: string, depth = 0) => {
    return tree.map((item: any) => (
      <div key={item.path} style={{ paddingLeft: depth * 14 }}>
        {item.type === 'dir' ? (
          <div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem', padding: '2px 0', cursor: 'default' }}>📁 {item.name}</div>
            {item.children && renderFileTree(item.children, projectName, depth + 1)}
          </div>
        ) : (
          <div
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const res = await fetch(`/telemetry/workspace/read?project=${encodeURIComponent(projectName)}&file=${encodeURIComponent(item.path)}`);
                const data = await res.json();
                setSelectedFile((prev: any) => ({ ...prev, _viewingFile: item.path, _fileContent: data.content }));
              } catch(err) { console.error(err); }
            }}
            style={{
              color: selectedFile?._viewingFile === item.path ? '#c4b5fd' : '#cbd5e1',
              fontSize: '0.8rem',
              padding: '2px 4px',
              cursor: 'pointer',
              borderRadius: '3px',
              background: selectedFile?._viewingFile === item.path ? 'rgba(139,92,246,0.15)' : 'transparent',
            }}
          >
            📄 {item.name}
          </div>
        )}
      </div>
    ));
  };


  const triggerSimulation = async () => {
    try {
      await fetch('/telemetry/telemetry/simulate', { method: 'POST' });
    } catch(e) { console.error('Sim Error', e); }
  };


  const fetchProjects = async () => {
    try {
      const res = await fetch('/telemetry/workspace/projects');
      const data = await res.json();
      setWorkspaceFiles(data.projects || []);
    } catch(e) { console.error(e); }
  };

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/metrics');
      const data = await res.json();
      const simulatedTokens = Math.floor((Date.now() / 1000 % 10000) * 15).toLocaleString(); // Just a fake growing number
      setSysMetrics({ cpu: data.cpu.usagePercent, ram: data.memory.percent, disk: data.disk.percent, tokens: simulatedTokens });
    } catch(e) {}
  };

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    fetchProjects();
    fetchMetrics();
    const fetchInterval = setInterval(() => { fetchProjects(); fetchMetrics(); }, 5000); // Poll every 5s for progress tracking
    const sse = new EventSource('/telemetry/telemetry/stream');
    sse.onmessage = (e) => {
        try {
            const state = JSON.parse(e.data);
            if (state.agents) setLiveAgents(state.agents);
            if (state.logs) setLiveLogs(state.logs);
            if (state.workItems) setWorkItems(state.workItems);
            if (state.completedItems) setCompletedItems(state.completedItems);
        } catch (err) { console.error('SSE Error:', err); }
    };
    return () => { clearInterval(timer); clearInterval(fetchInterval); sse.close(); };
  }, []);

  const rooms: (Room & { workItems: any[] })[] = [
    { title: 'Backlog / Triage', icon: '📋', agents: liveAgents.filter(a => a.room === 0), workItems: workItems.filter(w => w.room === 0) },
    { title: 'Research Lab', icon: '🔬', agents: liveAgents.filter(a => a.room === 1), workItems: workItems.filter(w => w.room === 1) },
    { title: 'Build Sandbox', icon: '🔨', agents: liveAgents.filter(a => a.room === 2), workItems: workItems.filter(w => w.room === 2) },
    { title: 'Testing / QA', icon: '🧪', agents: liveAgents.filter(a => a.room === 3), workItems: workItems.filter(w => w.room === 3) },
    { title: 'Code Review', icon: '🔎', agents: liveAgents.filter(a => a.room === 4), workItems: workItems.filter(w => w.room === 4) },
    { title: 'Ship / Deploy', icon: '🚀', agents: liveAgents.filter(a => a.room === 5), workItems: workItems.filter(w => w.room === 5) },
  ];

  const totalAgents = liveAgents.length;
  const activeAgents = liveAgents.filter(a => a.status === 'working').length;
  const skillCount = 47; // Will be live from PostgreSQL

  const activeProject = workspaceFiles && workspaceFiles.length > 0 ? workspaceFiles[0] : null;

  return (
    <div className="fade-in" id="factory-floor-page">
      {/* Page Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap' }}>
        <div style={{ flexShrink: 0, marginRight: '20px' }}>
          <h1 className="page-title">Live Pipeline</h1>
          <p className="page-subtitle">
            {currentTime.toLocaleTimeString('en-US', { hour12: false })} IST • Factory Floor Telemetry
          </p>
        </div>
        
        {/* Overall Progress Bar */}
        <div style={{ flexGrow: 1, maxWidth: '580px', margin: '0 20px', background: 'rgba(0,0,0,0.2)', padding: '10px 16px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '6px' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '0.65rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Project</span>
              <span style={{ fontSize: '0.85rem', color: '#e2e8f0', fontWeight: 600 }}>{activeProject ? activeProject.name.replace(/^\d{4}-\d{2}-\d{2}_/, '') : 'No active projects'}</span>
            </div>
            <div style={{ display: 'flex', gap: '20px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Engaged (CPU / RAM)</span>
                <span style={{ fontSize: '0.8rem', color: '#8b5cf6', fontWeight: 700 }}>{sysMetrics ? `${sysMetrics.cpu}% / ${sysMetrics.ram}%` : '--'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Storage</span>
                <span style={{ fontSize: '0.8rem', color: '#0ea5e9', fontWeight: 700 }}>{sysMetrics ? `${sysMetrics.disk}%` : '--'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>API Tokens</span>
                <span style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 700 }}>{sysMetrics ? `${sysMetrics.tokens}` : '--'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', width: '70px' }}>
                <span style={{ fontSize: '0.6rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Progress</span>
                <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700 }}>{activeProject ? activeProject.completion || '0%' : '0%'}</span>
              </div>
            </div>
          </div>
          <div style={{ width: '100%', height: '6px', background: 'rgba(0,0,0,0.5)', borderRadius: '3px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.03)' }}>
             <div style={{ 
               width: activeProject ? activeProject.completion || '0%' : '0%', 
               height: '100%', 
               background: 'linear-gradient(90deg, #b91c1c, #ea580c, #f59e0b, #84cc16, #22c55e)',
               transition: 'width 1s ease-in-out'
             }} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
          <button
            onClick={triggerSimulation}
            style={{ padding: '6px 12px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '8px', color: '#94a3b8', cursor: 'pointer', whiteSpace: 'nowrap', fontSize: '0.8rem' }}
          >
            ▶ Run Demo
          </button>
          <div className="header-badge badge-online">
            <span className="badge-dot" />
            All Systems Online
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="stats-bar">
        <div className="glass-panel stat-card" id="stat-agents">
          <div className="stat-icon purple">👥</div>
          <div className="stat-data">
            <span className="stat-value">{totalAgents}</span>
            <span className="stat-label">Agents Online</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-active">
          <div className="stat-icon blue">⚡</div>
          <div className="stat-data">
            <span className="stat-value">{activeAgents}</span>
            <span className="stat-label">Currently Working</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-skills">
          <div className="stat-icon green">🧠</div>
          <div className="stat-data">
            <span className="stat-value">{skillCount}</span>
            <span className="stat-label">Skills Learned</span>
          </div>
        </div>
        <div className="glass-panel stat-card" id="stat-infra">
          <div className="stat-icon amber">🏗️</div>
          <div className="stat-data">
            <span className="stat-value">{INFRA_SERVICES.length}</span>
            <span className="stat-label">Services Running</span>
          </div>
        </div>
      </div>

      {/* Factory Floor Grid */}
      <div className="factory-grid" id="factory-grid">
        {rooms.map((room, idx) => (
          <div key={idx} className="glass-panel factory-room" id={`room-${idx}`}>
            <div className="room-header">
              <span className="room-title">{room.title}</span>
              <span className="room-count">{room.agents.length}</span>
            </div>
            <div className="agents-area">
              {room.agents.map((agent) => (
                <motion.div 
                  layoutId={`agent-${agent.id}`} 
                  key={agent.id} 
                  className="agent-sprite" 
                  title={`${agent.name} — ${agent.role} (${agent.model})`} 
                  transition={{ type: "spring", stiffness: 80, damping: 12, mass: 1 }}
                  whileHover={{ scale: 1.1, rotate: 2 }}
                >
                  <motion.div 
                    className="agent-avatar"
                    animate={agent.status === 'working' ? {
                      boxShadow: ['0px 0px 0px rgba(0,0,0,0)', '0px 0px 15px rgba(251, 146, 60, 0.8)', '0px 0px 0px rgba(0,0,0,0)'],
                      scale: [1, 1.05, 1],
                    } : {}}
                    transition={{ repeat: Infinity, duration: 1.5 }}
                  >
                    <img 
                      src={`https://api.dicebear.com/9.x/${agent.role.includes('SRE') ? 'bottts' : 'pixel-art'}/svg?seed=${agent.name}`} 
                      alt={agent.name} 
                      style={{ width: '64px', height: '64px', imageRendering: 'pixelated' }} 
                    />
                    <span className={`agent-status-indicator ${agent.status}`} />
                  </motion.div>
                  <span className="agent-name">{agent.name}</span>
                  <span className="agent-role">{agent.role}</span>
                </motion.div>
              ))}

              {room.workItems.map((item) => (
                <motion.div 
                  layoutId={`work-${item.id}`} 
                  key={item.id} 
                  className="work-item-box"
                  transition={{ type: "spring", stiffness: 60, damping: 10, mass: 1 }}
                  style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginLeft: '12px' }}
                >
                  <div style={{ padding: '6px 8px', background: `${item.color}20`, border: `1px solid ${item.color}80`, borderRadius: '6px', fontSize: '1.2rem', boxShadow: `0 0 15px ${item.color}30` }}>
                    📦
                  </div>
                  <span style={{ fontSize: '0.6rem', color: item.color, fontWeight: 'bold' }}>{item.id}</span>
                </motion.div>
              ))}
              {room.agents.length === 0 && room.workItems.length === 0 && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  — Empty —
                </span>
              )}
            </div>
            <span className="room-icon">{room.icon}</span>
          </div>
        ))}
      </div>

      {/* Bottom Track Conveyor Belt */}
      <div className="pipeline-conveyor-tracker">
        <div className="conveyor-labels">
          <span>Backlog</span>
          <span>Build Sandbox</span>
          <span>QA Testing</span>
          <span>Code Review</span>
          <span>Deploy</span>
        </div>
        <div className="conveyor-stages">
          {[0, 2, 3, 4, 5].map((roomId) => (
            <div key={roomId} className="conveyor-stage-zone">
              {workItems.filter(w => w.room === roomId).map((item, idx) => (
                <motion.div 
                  layoutId={`belt-${item.id}`} 
                  key={item.id} 
                  className="belt-item"
                  transition={{ type: "spring", stiffness: 60, damping: 10, mass: 1 }}
                  style={{ 
                    background: `${item.color}20`, 
                    border: `1px solid ${item.color}`, 
                    boxShadow: `0 0 10px ${item.color}40`,
                    transform: `translateY(${idx * -5}px)`
                  }}
                >
                  <span style={{ fontSize: '1rem' }}>📦</span>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.6rem', color: item.color, fontWeight: 'bold' }}>{item.id}</span>
                    <span style={{ fontSize: '0.45rem', color: 'var(--text-muted)' }}>{item.name}</span>
                  </div>
                </motion.div>
              ))}
            </div>
          ))}
        </div>
        <div className="conveyor-track"></div>
        {/* Shipped Warehouse Button inside the tracker */}
        <button 
          onClick={() => setShowCompletedModal(!showCompletedModal)}
          style={{ position: 'absolute', right: '10px', top: '10px', background: 'var(--accent-primary)', border: 'none', padding: '6px 12px', borderRadius: '4px', color: '#fff', cursor: 'pointer', zIndex: 10 }}
        >
          📦 Shipped ({completedItems.length})
        </button>
      </div>

      {showCompletedModal && (
        <div style={{ position: 'absolute', right: '20px', bottom: '150px', background: 'rgba(15, 20, 35, 0.95)', border: '1px solid var(--border-glass)', borderRadius: '8px', padding: '16px', zIndex: 100, backdropFilter: 'blur(10px)', width: '300px', boxShadow: '0 0 30px rgba(0,0,0,0.8)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-glass)', paddingBottom: '8px', marginBottom: '10px' }}>
            <span style={{ fontWeight: 'bold' }}>Shipped Modules</span>
            <button onClick={() => setShowCompletedModal(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}>×</button>
          </div>
          {completedItems.length === 0 ? <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No modules shipped yet.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
              {completedItems.map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '8px', borderRadius: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: item.color }}>📦</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: item.color }}>{item.id}</span>
                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{item.name}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: '0.65rem', background: '#34d39922', color: '#34d399', padding: '2px 6px', borderRadius: '10px' }}>{item.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bottom Panels */}
      <div className="bottom-panels">
        {/* Activity Log */}
        <div className={`glass-panel ${isTerminalExpanded ? 'expanded-terminal' : ''}`} id="activity-log">
          <div className="panel-header">
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span className="panel-title">📡 Agent Activity Log</span>
              <button onClick={triggerSimulation} style={{ background: 'var(--accent-primary)', border: 'none', color: '#fff', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem', marginLeft: '10px' }}>
                ▶ Start Demo Pipeline
              </button>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{isTerminalExpanded ? 'Live STDOUT Stream' : 'Awaiting WebSocket'}</span>
              <button 
                onClick={() => setIsTerminalExpanded(!isTerminalExpanded)}
                style={{ background: 'var(--bg-glass-hover)', border: '1px solid var(--border-glass)', color: '#fff', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.7rem' }}
              >
                {isTerminalExpanded ? 'Shrink' : 'Expand Terminal'}
              </button>
            </div>
          </div>
          <div className="panel-body">
            <div className={`log-entries ${isTerminalExpanded ? 'terminal-mode' : ''}`}>
              <AnimatePresence initial={false}>
              {liveLogs.map((log, idx) => (
                <motion.div 
                  key={log.time + log.message + idx} 
                  className="log-entry"
                  initial={{ opacity: 0, x: -20, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: 'auto' }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  transition={{ duration: 0.3 }}
                >
                  <span className="log-time">{log.time}</span>
                  <span className={`log-agent ${log.agent}`}>{log.agentLabel}</span>
                  <span className="log-message">{log.message}</span>
                </motion.div>
              ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Infrastructure Health */}
        <div className="glass-panel" id="infra-health">
          <div className="panel-header">
            <span className="panel-title">🏗️ Infrastructure Health</span>
            <span style={{ fontSize: '0.65rem', color: 'var(--status-online)' }}>All Healthy</span>
          </div>
          <div className="panel-body">
            <div className="infra-grid">
              {INFRA_SERVICES.map((svc, idx) => (
                <div key={idx} className="infra-item">
                  <span className={`infra-dot ${svc.status}`} />
                  <div className="infra-info">
                    <span className="infra-name">{svc.name}</span>
                    <span className="infra-detail">{svc.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ Projects Browser ═══ */}
      <div className="glass-panel" style={{ marginTop: '16px' }}>
        <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="panel-title">📦 Projects — Generated Apps</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={async () => {
              try {
                const res = await fetch('/telemetry/workspace/projects');
                const data = await res.json();
                setWorkspaceFiles(data.projects || []);
                setSelectedFile(null);
                setRunOutput('');
              } catch(e) { console.error(e); }
            }} style={{ padding: '4px 12px', background: 'rgba(139,92,246,0.2)', border: '1px solid rgba(139,92,246,0.4)', borderRadius: '4px', color: '#c4b5fd', cursor: 'pointer', fontSize: '0.8rem' }}>
              🔄 Refresh
            </button>
          </div>
        </div>
        <div className="panel-body">
          {workspaceFiles.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>No projects yet. Submit a task above to generate an app.</p>
          ) : (
            <div>
              {/* Project Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                {workspaceFiles.map((proj: any) => (
                  <div
                    key={proj.name}
                    onClick={async () => {
                      try {
                        const res = await fetch(`/telemetry/workspace/files?project=${encodeURIComponent(proj.name)}`);
                        const data = await res.json();
                        setSelectedFile({ ...proj, tree: data.tree || [] });
                        setRunOutput('');
                      } catch(e) { console.error(e); }
                    }}
                    style={{
                      padding: '14px',
                      background: selectedFile?.name === proj.name ? 'rgba(139,92,246,0.15)' : 'rgba(255,255,255,0.03)',
                      border: selectedFile?.name === proj.name ? '1px solid rgba(139,92,246,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '10px',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.9rem' }}>📁 {proj.name.replace(/^\d{4}-\d{2}-\d{2}_/, '')}</span>
                      <span style={{
                        padding: '2px 8px',
                        borderRadius: '4px',
                        fontSize: '0.7rem',
                        fontWeight: 600,
                        background: proj.status === 'PASS' ? 'rgba(34,197,94,0.2)' : proj.status === 'NEEDS_REVIEW' ? 'rgba(245,158,11,0.2)' : 'rgba(99,102,241,0.2)',
                        color: proj.status === 'PASS' ? '#4ade80' : proj.status === 'NEEDS_REVIEW' ? '#fbbf24' : '#818cf8',
                        border: `1px solid ${proj.status === 'PASS' ? 'rgba(34,197,94,0.3)' : proj.status === 'NEEDS_REVIEW' ? 'rgba(245,158,11,0.3)' : 'rgba(99,102,241,0.3)'}`,
                      }}>
                        {proj.status === 'PASS' ? '✅ Passed' : proj.status === 'NEEDS_REVIEW' ? '⚠️ Review' : '🔄 In Progress'}
                      </span>
                    </div>
                    {/* Dev Progress Bar */}
                    <div style={{ marginBottom: '8px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px' }}>
                        <span>Dev Progress</span>
                        <span>{proj.completion || '0%'}</span>
                      </div>
                      <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden' }}>
                        <div style={{ 
                          width: proj.completion || '0%', 
                          height: '100%', 
                          background: 'linear-gradient(90deg, #8b5cf6, #3b82f6)',
                          transition: 'width 0.5s ease-in-out'
                        }} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '12px', color: '#64748b', fontSize: '0.75rem' }}>
                      <span>📄 {proj.fileCount} files</span>
                      <span>🕐 {new Date(proj.modified).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                      {proj.hasReport && <span>📊 Report</span>}
                    </div>
                  </div>
                ))}
              </div>

              {/* File Tree + File Viewer */}
              {selectedFile?.tree && (
                <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: '12px' }}>
                  {/* File Tree */}
                  <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', border: '1px solid rgba(255,255,255,0.06)', maxHeight: '400px', overflow: 'auto' }}>
                    <div style={{ color: '#c4b5fd', fontWeight: 600, fontSize: '0.85rem', marginBottom: '8px' }}>📁 {selectedFile.name.replace(/^\d{4}-\d{2}-\d{2}_/, '')}</div>
                    {renderFileTree(selectedFile.tree, selectedFile.name)}
                  </div>
                  {/* File Content */}
                  <div>
                    {selectedFile._viewingFile ? (
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <span style={{ color: '#c4b5fd', fontWeight: 'bold', fontSize: '0.85rem' }}>📄 {selectedFile._viewingFile}</span>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={async () => {
                              try {
                                const res = await fetch('/telemetry/workspace/run', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ project: selectedFile.name, command: 'npm test 2>&1 || echo "No tests configured"' })
                                });
                                const data = await res.json();
                                setRunOutput(`Exit: ${data.exitCode}\n${data.output}`);
                              } catch(e) { setRunOutput('Run failed: ' + e); }
                            }} style={{ padding: '4px 10px', background: 'rgba(245,158,11,0.2)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '4px', color: '#fbbf24', cursor: 'pointer', fontSize: '0.75rem' }}>
                              🧪 Run Tests
                            </button>
                            <button onClick={async () => {
                              try {
                                const res = await fetch('/telemetry/workspace/run', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ project: selectedFile.name, command: 'npm start 2>&1 || node src/server.js 2>&1 || node src/index.js 2>&1' })
                                });
                                const data = await res.json();
                                setRunOutput(`Exit: ${data.exitCode}\n${data.output}`);
                              } catch(e) { setRunOutput('Run failed: ' + e); }
                            }} style={{ padding: '4px 10px', background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600 }}>
                              ▶ Run App
                            </button>
                          </div>
                        </div>
                        <pre style={{ background: 'rgba(0,0,0,0.5)', padding: '14px', borderRadius: '8px', color: '#a5f3fc', fontSize: '0.78rem', overflow: 'auto', maxHeight: '320px', border: '1px solid rgba(255,255,255,0.08)', lineHeight: 1.5 }}>
                          {selectedFile._fileContent || 'Loading...'}
                        </pre>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '200px', color: '#64748b', fontSize: '0.9rem' }}>
                        ← Click a file to view its contents
                      </div>
                    )}
                    {runOutput && (
                      <div style={{ marginTop: '8px' }}>
                        <span style={{ color: '#34d399', fontWeight: 'bold', fontSize: '0.8rem' }}>Console Output:</span>
                        <pre style={{ background: 'rgba(0,0,0,0.6)', padding: '12px', borderRadius: '6px', color: '#fbbf24', fontSize: '0.78rem', marginTop: '4px', border: '1px solid rgba(52,211,153,0.3)', maxHeight: '200px', overflow: 'auto' }}>
                          {runOutput}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FactoryFloor;
